import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runProcess } from './process-runner.js';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createMp3Inspector(options: { ffprobe: string; cwd: string; timeoutMs: number }) {
  return {
    async inspect(file: FileHandle, signal: AbortSignal) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
      try {
        const result = await runProcess({
          executable: options.ffprobe,
          args: [
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
          cwd: options.cwd,
          allowedCwds: [options.cwd],
          signal: AbortSignal.any([signal, timeout.signal]),
          stdinFd: file.fd,
          env: {
            PATH: `${dirname(options.ffprobe)}:${dirname(process.execPath)}:/usr/bin:/bin`,
            LANG: 'C.UTF-8',
          },
          limits: { stdoutBytes: 1024 * 1024, stderrBytes: 128 * 1024, graceMs: 50 },
        });
        if (result.exitCode !== 0 || result.signal !== null) throw new Error('invalid_media');
        let info: unknown;
        try {
          info = JSON.parse(result.stdout);
        } catch {
          throw new Error('invalid_media');
        }
        const data = object(info) ? info : null;
        const format = data && object(data.format) ? data.format : null;
        const valid =
          data !== null &&
          Array.isArray(data.streams) &&
          data.streams.some(
            (stream) =>
              object(stream) && stream.codec_type === 'audio' && stream.codec_name === 'mp3',
          ) &&
          format !== null &&
          format.format_name === 'mp3';
        const comment = valid && format && object(format.tags) ? format.tags.comment : undefined;
        return { valid, comment: typeof comment === 'string' ? comment : null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
