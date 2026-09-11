import type { MetadataReferences } from './reference-check.js';
import type { OrganizationMovePreimage } from './organization-file-store.js';
import type { OrganizationClaim } from '../storage/organization-repository.js';

interface RepositoryPort {
  recordReferences(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      baseline: MetadataReferences;
    },
  ): unknown;
  recordMovePreimage(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      preimage: OrganizationMovePreimage;
    },
  ): unknown;
  transition(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'moving' | 'moved' | 'failed' | 'conflict' | 'recovery_required';
      errorCode?: string;
    },
  ): unknown;
  resumeRecovery(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'moving' | 'moved';
    },
  ): unknown;
}

interface FileStorePort {
  prepare(input: {
    libraryId: string;
    sourceKey: string;
    targetKey: string;
  }): Promise<OrganizationMovePreimage>;
  move(input: OrganizationMovePreimage): Promise<unknown>;
  classify(input: OrganizationMovePreimage): Promise<'source_only' | 'target_only' | 'ambiguous'>;
}

export function createOrganizationWorker(options: {
  repository: RepositoryPort;
  authorize(claim: OrganizationClaim): Promise<{ client: unknown }>;
  captureReferences(client: unknown, trackId: string): Promise<MetadataReferences>;
  fileStore: FileStorePort;
  fileIdentity(libraryId: string, key: string): string;
}) {
  const fence = (claim: OrganizationClaim) => ({
    itemId: claim.itemId,
    workerId: claim.workerId,
    generation: claim.generation,
  });
  return {
    async process(claim: OrganizationClaim) {
      let renameBoundary = false;
      try {
        const account = await options.authorize(claim);
        if (claim.stage === 'validating') {
          const baseline = await options.captureReferences(account.client, claim.oldTrackId);
          options.repository.recordReferences({ ...fence(claim), baseline });
        } else if (claim.stage !== 'references_captured') {
          throw new Error('invalid_transition');
        }
        const preimage = await options.fileStore.prepare({
          libraryId: claim.libraryId,
          sourceKey: claim.sourceKey,
          targetKey: claim.targetKey,
        });
        if (preimage.audioIdentity !== claim.audioIdentity) throw new Error('audio_mismatch');
        options.repository.recordMovePreimage({ ...fence(claim), preimage });
        options.repository.transition({ ...fence(claim), stage: 'moving' });
        renameBoundary = true;
        await options.fileStore.move(preimage);
        options.repository.transition({ ...fence(claim), stage: 'moved' });
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : 'worker_interrupted';
        options.repository.transition({
          ...fence(claim),
          stage: renameBoundary
            ? 'recovery_required'
            : code === 'destination_conflict'
              ? 'conflict'
              : 'failed',
          errorCode: code,
        });
        throw cause;
      }
    },
    async recover(claim: OrganizationClaim) {
      if (!claim.preimage) throw new Error('move_uncertain');
      const preimage: OrganizationMovePreimage = {
        libraryId: claim.libraryId,
        sourceKey: claim.sourceKey,
        targetKey: claim.targetKey,
        sourceFenceIdentity: options.fileIdentity(claim.libraryId, claim.sourceKey),
        targetFenceIdentity: options.fileIdentity(claim.libraryId, claim.targetKey),
        ...claim.preimage,
        size: 0,
      };
      if (preimage.sourceFenceIdentity !== claim.fileIdentity) throw new Error('move_uncertain');
      const state = await options.fileStore.classify(preimage);
      if (state === 'ambiguous') throw new Error('move_uncertain');
      options.repository.resumeRecovery({
        ...fence(claim),
        stage: state === 'target_only' ? 'moved' : 'moving',
      });
      if (state === 'source_only') {
        await options.fileStore.move(preimage);
        options.repository.transition({ ...fence(claim), stage: 'moved' });
      }
    },
  };
}
