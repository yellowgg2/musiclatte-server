import { isAbsolute } from 'node:path';
import { createMetadataFileAccess, type MetadataFileAccessOptions } from './file-access.js';
import { validateRelativeKey } from '../imports/policy.js';
import { runProcess } from '../imports/process-runner.js';

export const metadataProtectiveDefaults = Object.freeze({
  maxTargets: 64,
  coverBytes: 8 * 1024 * 1024,
  coverPixels: 16000000,
  textCodePoints: 4096,
  lyricsBytes: 256 * 1024,
  timeoutMs: 60000,
});

export interface MetadataTagSnapshot {
  id3Version: number;
  editable: boolean;
  reason: string | null;
  values: {
    title: string | null;
    artist: string[];
    album: string | null;
    albumArtist: string[];
    trackNumber: string | null;
    year: string | null;
    genre: string[];
  };
  coverFrames: {
    frameId: string;
    description: string;
    pictureType: number;
    mimeType: string;
    digest: string;
  }[];
  lyricsFrames: { selector: { language: string; description: string }; text: string }[];
  fullDigest: string;
  audio: {
    codec: 'mp3';
    sampleRate: string;
    channels: number;
    duration: string | null;
    packetHash: string;
    packetCount: number;
  };
}
const errors = new Set([
  'file_unavailable',
  'read_unstable',
  'file_too_large',
  'invalid_metadata',
  'unsupported_tag_layout',
  'unsupported_format',
  'invalid_cover',
  'ambiguous_selector',
  'revision_conflict',
  'audio_mismatch',
  'helper_unavailable',
]);

function decodeSnapshot(value: unknown): MetadataTagSnapshot {
  const v = value as MetadataTagSnapshot;
  const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  if (
    !v ||
    typeof v !== 'object' ||
    Object.keys(v).length !== 8 ||
    !Number.isInteger(v.id3Version) ||
    typeof v.editable !== 'boolean' ||
    !(v.reason === null || v.reason === 'unsupported_tag_layout') ||
    !hash(v.fullDigest) ||
    !v.values ||
    Object.keys(v.values).length !== 7 ||
    !['title', 'album', 'trackNumber', 'year'].every((k) => {
      const x = v.values[k as 'title'];
      return x === null || typeof x === 'string';
    }) ||
    !['artist', 'albumArtist', 'genre'].every((k) => {
      const x = v.values[k as 'artist'];
      return Array.isArray(x) && x.every((t) => typeof t === 'string');
    }) ||
    !Array.isArray(v.coverFrames) ||
    !v.coverFrames.every(
      (f) =>
        f &&
        hash(f.frameId) &&
        hash(f.digest) &&
        typeof f.description === 'string' &&
        Number.isInteger(f.pictureType) &&
        typeof f.mimeType === 'string',
    ) ||
    !Array.isArray(v.lyricsFrames) ||
    !v.lyricsFrames.every(
      (f) =>
        f &&
        typeof f.text === 'string' &&
        f.selector &&
        typeof f.selector.language === 'string' &&
        typeof f.selector.description === 'string',
    ) ||
    !v.audio ||
    v.audio.codec !== 'mp3' ||
    !hash(v.audio.packetHash) ||
    !Number.isSafeInteger(v.audio.packetCount) ||
    v.audio.packetCount < 1 ||
    typeof v.audio.sampleRate !== 'string' ||
    !Number.isInteger(v.audio.channels) ||
    !(v.audio.duration === null || typeof v.audio.duration === 'string')
  )
    throw new Error('helper_unavailable');
  return v;
}

/** Private descriptor-based helper IPC. Public routes must project a separate DTO. */
export function createMetadataHelper(
  options: MetadataFileAccessOptions & { ffmpeg: string; ffprobe: string },
) {
  const { rootIdentity } = createMetadataFileAccess(options);
  if (![options.ffmpeg, options.ffprobe].every(isAbsolute))
    throw new Error('invalid_metadata_config');
  async function invoke(
    action: 'read' | 'prepare',
    key: string,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    validateRelativeKey(key);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(
      cancel,
      Math.min(options.timeoutMs, metadataProtectiveDefaults.timeoutMs),
    );
    try {
      const result = await runProcess({
        executable: options.python,
        args: ['-I', '-B', options.helperPath],
        cwd: options.musicRoot,
        allowedCwds: [options.musicRoot],
        signal: controller.signal,
        stdinText: JSON.stringify({
          schemaVersion: 1,
          action,
          root: options.musicRoot,
          rootIdentity,
          key,
          maxFileBytes: options.maxFileBytes,
          ffmpeg: options.ffmpeg,
          ffprobe: options.ffprobe,
          ...extra,
        }),
        limits: { stdoutBytes: 1024 * 1024, stderrBytes: 4096, graceMs: 100 },
      });
      if (result.exitCode !== 0) throw new Error('helper_unavailable');
      const value: unknown = JSON.parse(result.stdout);
      if (value && typeof value === 'object' && 'error' in value) {
        throw new Error(
          typeof value.error === 'string' && errors.has(value.error)
            ? value.error
            : 'helper_unavailable',
        );
      }
      return value;
    } catch (error) {
      if (error instanceof Error && errors.has(error.message)) throw error;
      throw new Error('helper_unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    async read(input: { key: string; signal?: AbortSignal }) {
      return decodeSnapshot(await invoke('read', input.key, {}, input.signal));
    },
    async prepare(input: {
      candidateKey: string;
      expectedDigest: string;
      patch: unknown;
      cover?: { key: string };
      signal?: AbortSignal;
    }) {
      if (input.cover) validateRelativeKey(input.cover.key);
      const value = await invoke(
        'prepare',
        input.candidateKey,
        {
          expectedDigest: input.expectedDigest,
          patch: input.patch,
          ...(input.cover
            ? { cover: { root: options.musicRoot, rootIdentity, key: input.cover.key } }
            : {}),
        },
        input.signal,
      );
      if (
        !value ||
        typeof value !== 'object' ||
        !('audioPreserved' in value) ||
        value.audioPreserved !== true ||
        !('untouchedFramesPreserved' in value) ||
        value.untouchedFramesPreserved !== true ||
        !('snapshot' in value)
      ) {
        throw new Error('helper_unavailable');
      }
      return {
        audioPreserved: true,
        untouchedFramesPreserved: true,
        snapshot: decodeSnapshot(value.snapshot),
      };
    },
  };
}
