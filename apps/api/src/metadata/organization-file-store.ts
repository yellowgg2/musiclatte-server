import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { runProcess } from '../imports/process-runner.js';
import { validateRelativeKey } from '../imports/policy.js';
import { withMediaFences, type createMediaFence } from './media-fence.js';
import { createMetadataFileAccess } from './file-access.js';

export interface OrganizationMovePreimage {
  libraryId: string;
  sourceKey: string;
  targetKey: string;
  sourceFenceIdentity: string;
  targetFenceIdentity: string;
  device: string;
  inode: string;
  digest: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  audioIdentity: string;
  targetParentDevice: string;
  targetParentInode: string;
}

type HelperIdentity = Pick<
  OrganizationMovePreimage,
  'device' | 'inode' | 'digest' | 'mode' | 'uid' | 'gid' | 'size'
>;

const knownErrors = new Set([
  'destination_conflict',
  'unsafe_target',
  'file_unavailable',
  'identity_mismatch',
  'cross_device',
  'move_uncertain',
]);

function decodeIdentity(value: unknown): HelperIdentity {
  const row = value as Record<string, unknown>;
  if (
    !row ||
    !/^[a-f0-9]{64}$/.test(String(row.digest)) ||
    !/^\d+$/.test(String(row.device)) ||
    !/^\d+$/.test(String(row.inode)) ||
    !['mode', 'uid', 'gid', 'size'].every(
      (key) =>
        typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && Number(row[key]) >= 0,
    )
  )
    throw new Error('helper_unavailable');
  return {
    digest: String(row.digest),
    device: String(row.device),
    inode: String(row.inode),
    mode: Number(row.mode),
    uid: Number(row.uid),
    gid: Number(row.gid),
    size: Number(row.size),
  };
}

function decodeParentIdentity(value: unknown) {
  const row = value as Record<string, unknown>;
  if (!/^\d+$/.test(String(row.targetParentDevice)) || !/^\d+$/.test(String(row.targetParentInode)))
    throw new Error('helper_unavailable');
  return {
    targetParentDevice: String(row.targetParentDevice),
    targetParentInode: String(row.targetParentInode),
  };
}

export function createOrganizationFileStore(options: {
  musicRoot: string;
  python: string;
  helperPath: string;
  accessHelperPath: string;
  timeoutMs: number;
  maxFileBytes: number;
  fence: ReturnType<typeof createMediaFence>;
  fileIdentity(libraryId: string, key: string): string;
  inspectAudio(key: string): Promise<string>;
  assertAvailable?(fileIdentity: string): void;
}) {
  if (
    ![options.musicRoot, options.python, options.helperPath, options.accessHelperPath].every(
      isAbsolute,
    ) ||
    options.musicRoot === '/' ||
    realpathSync(options.musicRoot) !== options.musicRoot ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120_000 ||
    !Number.isSafeInteger(options.maxFileBytes) ||
    options.maxFileBytes < 1
  )
    throw new Error('invalid_organization_store');
  const root = lstatSync(options.musicRoot, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink() || (Number(root.mode) & 0o002) !== 0)
    throw new Error('invalid_organization_store');
  const rootIdentity = { device: String(root.dev), inode: String(root.ino) };
  const assertRoot = () => {
    const current = lstatSync(options.musicRoot, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      String(current.dev) !== rootIdentity.device ||
      String(current.ino) !== rootIdentity.inode ||
      (Number(current.mode) & 0o002) !== 0
    )
      throw new Error('invalid_organization_store');
  };
  const access = createMetadataFileAccess({
    musicRoot: options.musicRoot,
    python: options.python,
    helperPath: options.accessHelperPath,
    timeoutMs: options.timeoutMs,
    maxFileBytes: options.maxFileBytes,
  });

  async function invoke(
    action: 'prepare' | 'move' | 'classify',
    input: Pick<OrganizationMovePreimage, 'sourceKey' | 'targetKey'> &
      Partial<OrganizationMovePreimage>,
    crashAt?: 'before_rename' | 'after_rename' | 'after_fsync',
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      assertRoot();
      const expected =
        action === 'prepare'
          ? undefined
          : {
              digest: input.digest,
              device: input.device,
              inode: input.inode,
              mode: input.mode,
              uid: input.uid,
              gid: input.gid,
              targetParentDevice: input.targetParentDevice,
              targetParentInode: input.targetParentInode,
            };
      const result = await runProcess({
        executable: options.python,
        args: ['-I', '-B', options.helperPath],
        cwd: options.musicRoot,
        allowedCwds: [options.musicRoot],
        signal: controller.signal,
        stdinText: JSON.stringify({
          action,
          root: options.musicRoot,
          rootIdentity,
          sourceKey: input.sourceKey,
          targetKey: input.targetKey,
          maxFileBytes: options.maxFileBytes,
          ...(expected ? { expected } : {}),
          ...(crashAt ? { crashAt } : {}),
        }),
        limits: { stdoutBytes: 4096, stderrBytes: 4096, graceMs: 100 },
      });
      if (result.exitCode !== 0) throw new Error('worker_interrupted');
      const value = JSON.parse(result.stdout) as Record<string, unknown>;
      if (typeof value.error === 'string')
        throw new Error(knownErrors.has(value.error) ? value.error : 'helper_unavailable');
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async prepare(input: { libraryId: string; sourceKey: string; targetKey: string }) {
      assertRoot();
      validateRelativeKey(input.sourceKey);
      validateRelativeKey(input.targetKey);
      const sourceFenceIdentity = options.fileIdentity(input.libraryId, input.sourceKey);
      const targetFenceIdentity = options.fileIdentity(input.libraryId, input.targetKey);
      if (
        ![sourceFenceIdentity, targetFenceIdentity].every((value) => /^[a-f0-9]{64}$/.test(value))
      )
        throw new Error('invalid_organization_store');
      const descriptor = await access.inspect(input.sourceKey);
      const prepared = await invoke('prepare', input);
      const identity = decodeIdentity(prepared);
      const parentIdentity = decodeParentIdentity(prepared);
      if (
        identity.digest !== descriptor.digest ||
        identity.device !== descriptor.device ||
        identity.inode !== descriptor.inode ||
        identity.mode !== descriptor.mode ||
        identity.uid !== descriptor.uid ||
        identity.gid !== descriptor.gid
      )
        throw new Error('revision_conflict');
      const audioIdentity = await options.inspectAudio(input.sourceKey);
      if (!/^[a-f0-9]{64}$/.test(audioIdentity)) throw new Error('audio_mismatch');
      return {
        ...input,
        ...identity,
        ...parentIdentity,
        sourceFenceIdentity,
        targetFenceIdentity,
        audioIdentity,
      } satisfies OrganizationMovePreimage;
    },
    async move(
      input: OrganizationMovePreimage,
      control: { crashAt?: 'before_rename' | 'after_rename' | 'after_fsync' } = {},
    ) {
      return withMediaFences(
        options.fence,
        [input.sourceFenceIdentity, input.targetFenceIdentity],
        'publish',
        async () => {
          options.assertAvailable?.(input.sourceFenceIdentity);
          options.assertAvailable?.(input.targetFenceIdentity);
          const result = await invoke('move', input, control.crashAt);
          const identity = decodeIdentity(result);
          const audioIdentity = await options.inspectAudio(input.targetKey);
          if (audioIdentity !== input.audioIdentity) throw new Error('audio_mismatch');
          return { ...identity, audioIdentity };
        },
      );
    },
    async classify(input: OrganizationMovePreimage) {
      return withMediaFences(
        options.fence,
        [input.sourceFenceIdentity, input.targetFenceIdentity],
        'recover',
        async () => {
          const result = await invoke('classify', input);
          if (!['source_only', 'target_only', 'ambiguous'].includes(String(result.state)))
            throw new Error('helper_unavailable');
          return result.state as 'source_only' | 'target_only' | 'ambiguous';
        },
      );
    },
  };
}
