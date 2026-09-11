import { expect, it } from 'vitest';
import { createOrganizationWorker } from '../src/metadata/organization-worker.js';

const claim = {
  itemId: 'item',
  jobId: 'job',
  libraryId: 'library',
  workerId: 'worker',
  generation: 1,
  stage: 'validating' as const,
  sourceKey: 'source.mp3',
  targetKey: 'managed/target.mp3',
  fileIdentity: 'a'.repeat(64),
  audioIdentity: 'b'.repeat(64),
  oldTrackId: 'old',
  newTrackId: null,
  preimage: null,
};
const prepared = {
  libraryId: 'library',
  sourceKey: claim.sourceKey,
  targetKey: claim.targetKey,
  sourceFenceIdentity: claim.fileIdentity,
  targetFenceIdentity: 'c'.repeat(64),
  device: '1',
  inode: '2',
  digest: 'd'.repeat(64),
  mode: 0o640,
  uid: 1000,
  gid: 1000,
  size: 100,
  audioIdentity: claim.audioIdentity,
  targetParentDevice: '1',
  targetParentInode: '3',
};

it('durably captures account references and preimage before moving', async () => {
  const calls: string[] = [];
  const worker = createOrganizationWorker({
    repository: {
      recordReferences: () => calls.push('references'),
      recordMovePreimage: () => calls.push('preimage'),
      transition: (input) => calls.push(input.stage),
      resumeRecovery: () => calls.push('resume'),
    },
    authorize: async () => ({ client: {} }),
    captureReferences: async () => {
      calls.push('capture');
      return { trackId: 'old', starred: true, playlists: [] };
    },
    fileIdentity: (_libraryId, key) =>
      key === claim.sourceKey ? claim.fileIdentity : prepared.targetFenceIdentity,
    fileStore: {
      prepare: async () => {
        calls.push('prepare');
        return prepared;
      },
      move: async () => calls.push('rename'),
      classify: async () => 'source_only' as const,
    },
  });
  await worker.process(claim);
  expect(calls).toEqual([
    'capture',
    'references',
    'prepare',
    'preimage',
    'moving',
    'rename',
    'moved',
  ]);
});

it('leaves a post-rename crash for filesystem-owned forward recovery', async () => {
  const transitions: { stage: string; errorCode?: string }[] = [];
  const worker = createOrganizationWorker({
    repository: {
      recordReferences: () => {},
      recordMovePreimage: () => {},
      transition: (input) => transitions.push(input),
      resumeRecovery: (input) => transitions.push(input),
    },
    authorize: async () => ({ client: {} }),
    captureReferences: async () => ({ trackId: 'old', starred: false, playlists: [] }),
    fileIdentity: (_libraryId, key) =>
      key === claim.sourceKey ? claim.fileIdentity : prepared.targetFenceIdentity,
    fileStore: {
      prepare: async () => prepared,
      move: async () => {
        throw new Error('worker_interrupted');
      },
      classify: async () => 'target_only' as const,
    },
  });
  await expect(worker.process(claim)).rejects.toThrow('worker_interrupted');
  expect(transitions.at(-1)).toMatchObject({
    stage: 'recovery_required',
    errorCode: 'worker_interrupted',
  });
  await worker.recover({ ...claim, stage: 'recovery_required', preimage: prepared });
  expect(transitions.at(-1)).toMatchObject({ stage: 'moved' });
});

it('resumes from a durable reference baseline without capturing it twice', async () => {
  const calls: string[] = [];
  const worker = createOrganizationWorker({
    repository: {
      recordReferences: () => calls.push('references'),
      recordMovePreimage: () => calls.push('preimage'),
      transition: (input) => calls.push(input.stage),
      resumeRecovery: () => calls.push('resume'),
    },
    authorize: async () => ({ client: {} }),
    captureReferences: async () => {
      calls.push('capture');
      return { trackId: 'old', starred: false, playlists: [] };
    },
    fileIdentity: (_libraryId, key) =>
      key === claim.sourceKey ? claim.fileIdentity : prepared.targetFenceIdentity,
    fileStore: {
      prepare: async () => prepared,
      move: async () => calls.push('rename'),
      classify: async () => 'source_only' as const,
    },
  });
  await worker.process({ ...claim, stage: 'references_captured' });
  expect(calls).toEqual(['preimage', 'moving', 'rename', 'moved']);
});
