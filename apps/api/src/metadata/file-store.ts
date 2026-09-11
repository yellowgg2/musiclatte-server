import {
  mediaFenceRoot,
  type createMediaPublicationLedger,
  type PublicationFence,
} from './media-fence.js';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import { createMetadataFileAccess, type MetadataFileAccessOptions } from './file-access.js';
import { validateRelativeKey } from '../imports/policy.js';

export interface FileTransactionInput {
  itemId: string;
  fileIdentity: string;
  key: string;
  generation: number;
  expectedDigest: string;
  patch: unknown;
  preserveOwnership: boolean;
  restore?: { relativeKey: string; digest: string };
  cover?: {
    root: string;
    key: string;
    rootIdentity: { device: string; inode: string };
    expectedDigest?: string;
  };
}
export interface FileBackup {
  id: string;
  relativeKey: string;
  preimageDigest: string;
  size: number;
  mode: number;
  ownerProfile: { uid: number; gid: number };
}
export interface FileSavedReceipt {
  digest: string;
  backup: FileBackup;
  candidateKey: string;
}
export interface FileIntent {
  fileIdentity: string;
  key: string;
  preimageDigest: string;
  backup: FileBackup;
  candidateKey: string;
  candidateDigest: string | null;
}
export type FileRecovery = {
  state: 'preimage' | 'file_saved' | 'recovery_required';
  digest: string;
  intent: FileIntent | null;
};
export type FileTransactionEvent =
  | { stage: 'backup_verified'; backup: FileBackup }
  | { stage: 'candidate_verified'; digest: string; candidateKey: string }
  | ({ stage: 'file_saved' } & FileSavedReceipt);
const errorCodes = new Set([
  'file_busy',
  'file_unavailable',
  'worker_interrupted',
  'recovery_required',
  'revision_conflict',
  'backup_failed',
  'write_failed',
  'permission_changed',
  'invalid_metadata',
  'unsupported_tag_layout',
  'invalid_cover',
  'audio_mismatch',
  'file_too_large',
  'restore_unavailable',
  'ambiguous_selector',
  'unsupported_format',
  'read_unstable',
]);
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function backup(value: unknown): asserts value is FileBackup {
  const b = value as FileBackup;
  if (
    !b ||
    !hash(b.id) ||
    !hash(b.preimageDigest) ||
    !Number.isSafeInteger(b.size) ||
    b.size < 0 ||
    !Number.isInteger(b.mode) ||
    b.mode < 0 ||
    b.mode > 4095 ||
    !b.ownerProfile ||
    !Number.isSafeInteger(b.ownerProfile.uid) ||
    !Number.isSafeInteger(b.ownerProfile.gid)
  )
    throw new Error('helper_unavailable');
  validateRelativeKey(b.relativeKey);
}
/** One child and one OS lock span every fenced DB acknowledgement. */
export function createMetadataFileStore(
  options: MetadataFileAccessOptions & {
    privateRoot: string;
    ffmpeg: string;
    ffprobe: string;
    lockRoot?: string;
    publications?: ReturnType<typeof createMediaPublicationLedger>;
  },
) {
  if (options.publications && !options.lockRoot) throw new Error('invalid_metadata_config');
  if (
    options.lockRoot &&
    [options.musicRoot, options.privateRoot].some(
      (root) =>
        options.lockRoot === root ||
        options.lockRoot!.startsWith(root + sep) ||
        root.startsWith(options.lockRoot! + sep),
    )
  )
    throw new Error('invalid_metadata_config');
  const lockRootIdentity = options.lockRoot ? mediaFenceRoot(options.lockRoot) : undefined;
  const { rootIdentity } = createMetadataFileAccess(options);
  if (
    ![options.privateRoot, options.ffmpeg, options.ffprobe].every(isAbsolute) ||
    realpathSync(options.privateRoot) !== options.privateRoot
  )
    throw new Error('invalid_metadata_config');
  const privateStat = lstatSync(options.privateRoot, { bigint: true });
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink())
    throw new Error('invalid_metadata_config');
  const privateRootIdentity = { device: String(privateStat.dev), inode: String(privateStat.ino) };
  async function run(
    action: 'execute' | 'recover',
    input: FileTransactionInput,
    hooks?: {
      onEvent(event: FileTransactionEvent, control: { kill(): void }): Promise<void>;
      signal?: AbortSignal;
      onRecovered?(recovery: FileRecovery): Promise<void>;
    },
  ): Promise<FileSavedReceipt | FileRecovery> {
    validateRelativeKey(input.key);
    if (
      !hash(input.expectedDigest) ||
      !hash(input.fileIdentity) ||
      !input.itemId ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 1
    )
      throw new Error('invalid_metadata');
    const payload = JSON.stringify({
      ...input,
      schemaVersion: 1,
      action,
      root: options.musicRoot,
      rootIdentity,
      privateRoot: options.privateRoot,
      privateRootIdentity,
      ...(options.lockRoot ? { lockRoot: options.lockRoot, lockRootIdentity } : {}),
      ffmpeg: options.ffmpeg,
      ffprobe: options.ffprobe,
      maxFileBytes: options.maxFileBytes,
    });
    if (Buffer.byteLength(payload) > 1024 * 1024 - 1) throw new Error('invalid_metadata');
    return new Promise((resolve, reject) => {
      const child = spawn(options.python, ['-I', '-B', options.helperPath], {
        cwd: options.musicRoot,
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let publication: PublicationFence | undefined;
      let error: Error | undefined;
      let result: FileSavedReceipt | FileRecovery | undefined;
      let buffer = '';
      let count = 0;
      let stderr = 0;
      let chain = Promise.resolve();
      const kill = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }
      };
      const fail = (e: unknown) => {
        error ??= e instanceof Error ? e : new Error('helper_unavailable');
        kill();
      };
      const abort = () => fail(new Error('worker_interrupted'));
      const timer = setTimeout(abort, Math.min(options.timeoutMs, 60000));
      hooks?.signal?.addEventListener('abort', abort, { once: true });
      if (hooks?.signal?.aborted) abort();
      child.stdin.on('error', () => fail(new Error('worker_interrupted')));
      child.on('error', () => fail(new Error('helper_unavailable')));
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.length;
        if (stderr > 4096) fail(new Error('helper_unavailable'));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        count += Buffer.byteLength(data);
        buffer += data;
        if (count > 1024 * 1024 || buffer.length > 65536) {
          fail(new Error('helper_unavailable'));
          return;
        }
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          chain = chain
            .then(async () => {
              if (error) return;
              const value = JSON.parse(line) as Record<string, unknown>;
              if (value.error)
                throw new Error(
                  typeof value.error === 'string' && errorCodes.has(value.error)
                    ? value.error
                    : 'helper_unavailable',
                );
              if (value.stage === 'fence_acquired' && options.lockRoot) {
                publication = options.publications?.begin(
                  input.fileIdentity,
                  `${input.itemId}:${input.generation}`,
                );
                child.stdin.write(
                  JSON.stringify({ ack: 'fence_acquired', generation: input.generation }) + '\n',
                );
                return;
              }
              if (action === 'recover') {
                if (
                  value.stage !== 'recovered' ||
                  !['preimage', 'file_saved', 'recovery_required'].includes(String(value.state)) ||
                  !hash(value.digest)
                )
                  throw new Error('helper_unavailable');
                const intent = value.intent as FileIntent | null;
                if (intent) {
                  backup(intent.backup);
                  validateRelativeKey(intent.candidateKey);
                  if (
                    intent.fileIdentity !== input.fileIdentity ||
                    intent.key !== input.key ||
                    intent.preimageDigest !== input.expectedDigest ||
                    !(intent.candidateDigest === null || hash(intent.candidateDigest))
                  )
                    throw new Error('recovery_required');
                }
                result = {
                  state: value.state as FileRecovery['state'],
                  digest: value.digest,
                  intent,
                };
                await hooks?.onRecovered?.(result);
                if (publication && result.state === 'file_saved')
                  options.publications!.recordMediaPublication(publication, result.digest);
                if (options.lockRoot)
                  child.stdin.write(
                    JSON.stringify({ ack: 'recovered', generation: input.generation }) + '\n',
                  );
                return;
              }
              if (
                !['backup_verified', 'candidate_verified', 'file_saved'].includes(
                  String(value.stage),
                )
              )
                throw new Error('helper_unavailable');
              if (value.stage !== 'candidate_verified') backup(value.backup);
              if (value.stage !== 'backup_verified') {
                if (!hash(value.digest)) throw new Error('helper_unavailable');
                validateRelativeKey(value.candidateKey as string);
              }
              if (publication) options.publications!.validate(publication);
              if (publication && value.stage === 'candidate_verified')
                options.publications!.dirty(publication, input.itemId);
              if (publication && value.stage === 'file_saved')
                options.publications!.recordMediaPublication(publication, String(value.digest));
              await hooks!.onEvent(value as unknown as FileTransactionEvent, { kill });
              if (error) return;
              if (value.stage === 'file_saved') result = value as unknown as FileSavedReceipt;
              child.stdin.write(
                JSON.stringify({ ack: value.stage, generation: input.generation }) + '\n',
              );
            })
            .catch(fail);
        }
      });
      child.on('close', (code) => {
        void chain.finally(() => {
          clearTimeout(timer);
          hooks?.signal?.removeEventListener('abort', abort);
          if (error) reject(error);
          else if (code !== 0 || !result || buffer.trim()) reject(new Error('worker_interrupted'));
          else resolve(result);
        });
      });
      child.stdin.write(payload + '\n');
    });
  }
  return {
    execute: (
      input: FileTransactionInput,
      hooks: {
        onEvent(event: FileTransactionEvent, control: { kill(): void }): Promise<void>;
        signal?: AbortSignal;
      },
    ) => run('execute', input, hooks) as Promise<FileSavedReceipt>,
    recover: (
      input: FileTransactionInput,
      onRecovered?: (recovery: FileRecovery) => Promise<void>,
    ) =>
      run(
        'recover',
        input,
        onRecovered ? { onEvent: async () => {}, onRecovered } : undefined,
      ) as Promise<FileRecovery>,
  };
}
