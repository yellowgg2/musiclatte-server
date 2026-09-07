import { constants, lstatSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runProcess } from './process-runner.js';
import { resolveFileKey } from './file-keys.js';

export interface Engine {
  version: string;
  executable: string;
  release?: () => void;
}
export interface SourceMetadata {
  title: string;
  channel: string;
  channelId: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  !/[\x00-\x1f\x7f]/.test(value);
function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_media');
  }
}

export function decodeSourceMetadata(raw: string, sourceId: string): SourceMetadata {
  const data = json(raw);
  if (
    !object(data) ||
    data.id !== sourceId ||
    !text(data.title) ||
    (data._type !== undefined && data._type !== 'video')
  )
    throw new Error('invalid_metadata');
  const channel = data.channel ?? data.uploader;
  const channelId = data.channel_id ?? data.uploader_id;
  if (!text(channel) || typeof channelId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(channelId))
    throw new Error('invalid_metadata');
  return { title: data.title, channel, channelId };
}

/** Fixed downloader options and bounded process output, with an opened-file ffprobe verifier. */
export function createDownloader(options: {
  stagingRoot: string;
  ffprobe: string;
  timeoutMs: number;
}) {
  const execute = async (
    executable: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    stdinFd?: number,
  ) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
    try {
      const result = await runProcess({
        executable,
        args,
        cwd,
        allowedCwds: [cwd],
        signal: AbortSignal.any([signal, timeout.signal]),
        ...(stdinFd === undefined ? {} : { stdinFd }),
        env: {
          PATH: `${dirname(options.ffprobe)}:${dirname(process.execPath)}:/usr/bin:/bin`,
          LANG: 'C.UTF-8',
        },
        limits: { stdoutBytes: 1024 * 1024, stderrBytes: 128 * 1024, graceMs: 50 },
      });
      if (result.exitCode !== 0 || result.signal !== null) throw new Error('download_failed');
      return result.stdout;
    } finally {
      clearTimeout(timer);
    }
  };
  const inspectAudio = async (file: FileHandle, signal: AbortSignal) => {
    const info = json(
      await execute(
        options.ffprobe,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'pipe',
          '-show_entries',
          'stream=codec_type,codec_name:format=format_name:format_tags=comment',
          '-of',
          'json',
          '-i',
          'pipe:0',
        ],
        options.stagingRoot,
        signal,
        file.fd,
      ),
    );
    if (
      !object(info) ||
      !Array.isArray(info.streams) ||
      !info.streams.some(
        (stream) => object(stream) && stream.codec_type === 'audio' && stream.codec_name === 'mp3',
      ) ||
      !object(info.format) ||
      info.format.format_name !== 'mp3' ||
      !object(info.format.tags) ||
      typeof info.format.tags.comment !== 'string'
    )
      return { valid: false, sourceId: '' };
    const match = /^([A-Za-z0-9_-]{11})$/.exec(info.format.tags.comment);
    return { valid: Boolean(match), sourceId: match?.[1] ?? '' };
  };
  const validateFile = async (root: string, key: string, sourceId: string, signal: AbortSignal) => {
    const path = resolveFileKey(root, key);
    if (!key.endsWith('.mp3')) throw new Error('invalid_media');
    const before = lstatSync(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size === 0 ||
        stat.nlink !== 1 ||
        before.ino !== stat.ino ||
        before.dev !== stat.dev
      )
        throw new Error('invalid_media');
      const audio = await inspectAudio(file, signal);
      const after = await file.stat();
      const visible = lstatSync(resolveFileKey(root, key));
      if (
        !audio.valid ||
        audio.sourceId !== sourceId ||
        stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs ||
        stat.ctimeMs !== after.ctimeMs ||
        visible.ino !== stat.ino ||
        visible.dev !== stat.dev
      )
        throw new Error('invalid_media');
    } finally {
      await file.close();
    }
  };
  return {
    inspectAudio,
    validateFile,
    async run(
      sourceId: string,
      engine: Engine,
      stagingKey: string,
      signal: AbortSignal,
      stage: (stage: 'downloading' | 'postprocessing', metadata?: SourceMetadata) => void,
    ) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(sourceId)) throw new Error('invalid_metadata');
      const cwd = join(options.stagingRoot, stagingKey);
      const url = `https://www.youtube.com/watch?v=${sourceId}`;
      const common = [
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-cache-dir',
        '--no-playlist',
        '--no-progress',
        '--no-warnings',
      ];
      const metadata = decodeSourceMetadata(
        await execute(
          engine.executable,
          [...common, '--dump-single-json', '--skip-download', '--', url],
          cwd,
          signal,
        ),
        sourceId,
      );
      stage('downloading', metadata);
      const output = await execute(
        engine.executable,
        [
          ...common,
          '--no-simulate',
          '--no-exec',
          '--format',
          'bestaudio/best',
          '--extract-audio',
          '--audio-format',
          'mp3',
          '--embed-metadata',
          '--embed-thumbnail',
          '--parse-metadata',
          'id:meta_comment',
          '--output',
          join(cwd, 'audio.%(ext)s'),
          '--paths',
          `home:${cwd}`,
          '--paths',
          `temp:${cwd}`,
          '--print',
          'after_move:%(filepath)j',
          '--',
          url,
        ],
        cwd,
        signal,
      );
      stage('postprocessing');
      const lines = output.trim().split('\n');
      if (lines.length !== 1 || json(lines[0]!) !== join(cwd, 'audio.mp3'))
        throw new Error('invalid_media');
      const fileKey = `${stagingKey}/audio.mp3`;
      await validateFile(options.stagingRoot, fileKey, sourceId, signal);
      return { metadata, fileKey };
    },
  };
}
