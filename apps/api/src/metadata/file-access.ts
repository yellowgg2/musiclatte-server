import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { validateRelativeKey } from '../imports/policy.js';
import { runProcess } from '../imports/process-runner.js';

export interface MetadataFileInspection {
  schemaVersion: 1;
  digest: string;
  size: number;
  device: string;
  inode: string;
  mtimeNs: string;
  ctimeNs: string;
  mode: number;
  uid: number;
  gid: number;
  nlink: number;
  writable: boolean;
}
export interface MetadataFileAccessOptions {
  python: string;
  musicRoot: string;
  helperPath: string;
  timeoutMs: number;
  maxFileBytes: number;
}
/** The helper retains its own descriptors, returning only bounded private observations. */
export function createMetadataFileAccess(options: MetadataFileAccessOptions) {
  if (
    !isAbsolute(options.python) ||
    !isAbsolute(options.helperPath) ||
    !isAbsolute(options.musicRoot) ||
    options.musicRoot === '/' ||
    realpathSync(options.musicRoot) !== options.musicRoot ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120000 ||
    !Number.isSafeInteger(options.maxFileBytes) ||
    options.maxFileBytes < 1 ||
    options.maxFileBytes > 2 * 1024 * 1024 * 1024
  )
    throw new Error('invalid_metadata_config');
  const root = lstatSync(options.musicRoot, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('invalid_metadata_config');
  const rootIdentity = { device: String(root.dev), inode: String(root.ino) };
  return {
    rootIdentity,
    async inspect(key: string, signal?: AbortSignal): Promise<MetadataFileInspection> {
      validateRelativeKey(key);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(cancel, options.timeoutMs);
      try {
        const result = await runProcess({
          executable: options.python,
          args: ['-I', '-B', options.helperPath],
          cwd: options.musicRoot,
          allowedCwds: [options.musicRoot],
          stdinText: JSON.stringify({
            root: options.musicRoot,
            key,
            rootIdentity,
            maxFileBytes: options.maxFileBytes,
          }),
          signal: controller.signal,
          limits: { stdoutBytes: 4096, stderrBytes: 4096, graceMs: 100 },
        });
        if (result.exitCode !== 0) throw new Error('helper_unavailable');
        const value: unknown = JSON.parse(result.stdout);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const v = value as Record<string, unknown>;
        if ('error' in v) {
          if (
            ['file_unavailable', 'file_too_large', 'read_unstable', 'helper_unavailable'].includes(
              String(v.error),
            )
          )
            throw new Error(String(v.error));
          throw new Error();
        }
        if (
          Object.keys(v).length !== 12 ||
          v.schemaVersion !== 1 ||
          typeof v.digest !== 'string' ||
          !/^[a-f0-9]{64}$/.test(v.digest) ||
          typeof v.writable !== 'boolean'
        )
          throw new Error();
        for (const name of ['device', 'inode', 'mtimeNs', 'ctimeNs'])
          if (typeof v[name] !== 'string' || !/^[0-9]+$/.test(v[name])) throw new Error();
        for (const name of ['size', 'mode', 'uid', 'gid', 'nlink'])
          if (typeof v[name] !== 'number' || !Number.isSafeInteger(v[name]) || v[name] < 0)
            throw new Error();
        if (Number(v.size) > options.maxFileBytes || Number(v.mode) > 4095 || Number(v.nlink) < 1)
          throw new Error();
        return {
          schemaVersion: 1,
          digest: v.digest,
          size: Number(v.size),
          device: String(v.device),
          inode: String(v.inode),
          mtimeNs: String(v.mtimeNs),
          ctimeNs: String(v.ctimeNs),
          mode: Number(v.mode),
          uid: Number(v.uid),
          gid: Number(v.gid),
          nlink: Number(v.nlink),
          writable: v.writable && v.nlink === 1 && (Number(v.mode) & 0o222) !== 0,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          ['file_unavailable', 'file_too_large', 'read_unstable', 'helper_unavailable'].includes(
            error.message,
          )
        )
          throw error;
        throw new Error('file_unavailable');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
