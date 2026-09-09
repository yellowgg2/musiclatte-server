import { metadataErrorCodes, type MetadataErrorCode } from '@musiclatte/contracts';
import type { createMetadataRepository, MetadataClaim } from '../storage/metadata-repository.js';
import type { createMetadataFileStore, FileTransactionInput } from './file-store.js';
import { classifyMetadataRecovery } from './recovery.js';
export type MetadataWork = ReturnType<ReturnType<typeof createMetadataRepository>['readWork']>;
export interface MetadataWorkerOptions {
  repository: ReturnType<typeof createMetadataRepository>;
  fileStore: ReturnType<typeof createMetadataFileStore>;
  workerId: string;
  leaseDurationMs: number;
  /** Current session/scope/policy/binding checks and private upload resolution. */
  authorize(
    work: MetadataWork,
  ): Promise<{ preserveOwnership: boolean; cover?: FileTransactionInput['cover'] }>;
  revision(work: MetadataWork, digest: string): string;
  beforeWrite?(claim: MetadataClaim, work: MetadataWork): Promise<void>;
  /** S05 owns verified upstream reflection; omission leaves file_saved pending. */
  reflect?(claim: MetadataClaim, work: MetadataWork): Promise<void>;
}
export function createMetadataWorker(options: MetadataWorkerOptions) {
  const repo = options.repository;
  if (options.leaseDurationMs < 1000) throw new Error('invalid_metadata_config');
  let active = false;
  async function runOnce(signal?: AbortSignal, mode?: 'recovery' | 'file'): Promise<boolean> {
    if (active || signal?.aborted) return false;
    const claim = repo.claimNext({
      workerId: options.workerId,
      leaseDurationMs: options.leaseDurationMs,
      ...(mode === 'recovery' ? { recoveryOnly: true } : mode === 'file' ? { fileOnly: true } : {}),
    });
    if (!claim) return false;
    active = true;
    const timer = setInterval(
      () => {
        try {
          repo.renewClaim(claim, options.leaseDurationMs);
        } catch {
          /* Current child remains OS-fenced until it exits. */
        }
      },
      Math.max(100, Math.floor(options.leaseDurationMs / 3)),
    );
    try {
      let work = repo.readWork(claim);
      if (['file_saved', 'reflecting'].includes(work.stage)) {
        await options.reflect?.(claim, work);
        return true;
      }
      const input: FileTransactionInput = {
        itemId: work.itemId,
        fileIdentity: work.fileIdentity,
        key: work.key,
        generation: claim.generation,
        expectedDigest: work.expectedDigest,
        patch: work.patch,
        preserveOwnership: true,
        ...(work.restore ? { restore: work.restore } : {}),
      };
      if (claim.recovering) {
        await options.fileStore.recover(input, async (recovery) => {
          if (work.resultDigest && recovery.intent?.candidateDigest !== work.resultDigest) {
            repo.transition({ ...claim, stage: 'recovery_required', errorCode: 'write_uncertain' });
            return;
          }
          const disposition = classifyMetadataRecovery(recovery);
          if (disposition === 'receipt') {
            const intent = recovery.intent!;
            if (work.stage === 'preparing') {
              repo.recordBackup({ ...claim, backup: intent.backup });
              repo.transition({ ...claim, stage: 'backed_up' });
            }
            work = repo.readWork(claim);
            if (work.stage === 'backed_up')
              repo.transition({
                ...claim,
                stage: 'prepared',
                candidateKey: intent.candidateKey,
                resultDigest: recovery.digest,
                resultRevision: options.revision(work, recovery.digest),
              });
            repo.transition({
              ...claim,
              stage: 'file_saved',
              resultDigest: recovery.digest,
              resultRevision: options.revision(work, recovery.digest),
            });
          } else
            repo.transition({
              ...claim,
              stage: disposition === 'safe_failure' ? 'failed' : 'recovery_required',
              errorCode: disposition === 'safe_failure' ? 'worker_interrupted' : 'write_uncertain',
            });
        });
        if (repo.readWork(claim).stage === 'file_saved')
          await options.reflect?.(claim, repo.readWork(claim));
        return true;
      }
      if (work.bindingRevision !== work.currentBindingRevision)
        throw new Error('revision_conflict');
      const policy = await options.authorize(work);
      await options.beforeWrite?.(claim, work);
      Object.assign(input, policy);
      await options.fileStore.execute(input, {
        ...(signal ? { signal } : {}),
        onEvent: async (event) => {
          repo.assertClaim(claim);
          if (event.stage === 'backup_verified') {
            repo.recordBackup({ ...claim, backup: event.backup });
            repo.transition({ ...claim, stage: 'backed_up' });
          } else if (event.stage === 'candidate_verified') {
            await options.authorize(repo.readWork(claim));
            repo.transition({
              ...claim,
              stage: 'prepared',
              candidateKey: event.candidateKey,
              resultDigest: event.digest,
              resultRevision: options.revision(work, event.digest),
            });
          } else
            repo.transition({
              ...claim,
              stage: 'file_saved',
              resultDigest: event.digest,
              resultRevision: options.revision(work, event.digest),
            });
        },
      });
      await options.reflect?.(claim, repo.readWork(claim));
      return true;
    } catch (error) {
      try {
        const work = repo.readWork(claim);
        // A lost receipt or any failure after publish authorization must be classified under the OS lock.
        if (['prepared', 'file_saved', 'reflecting'].includes(work.stage)) return true;
        const code = error instanceof Error ? error.message : 'write_failed';
        if (code === 'file_busy' || code === 'worker_interrupted') return true;
        const mapped: MetadataErrorCode = metadataErrorCodes.includes(code as MetadataErrorCode)
          ? (code as MetadataErrorCode)
          : code === 'unsupported_tag_layout'
            ? 'unsupported_format'
            : 'write_failed';
        repo.transition({
          ...claim,
          stage:
            code === 'revision_conflict'
              ? 'conflict'
              : code === 'recovery_required'
                ? 'recovery_required'
                : 'failed',
          errorCode: code === 'recovery_required' ? 'write_uncertain' : mapped,
        });
      } catch {
        /* A newer generation owns recovery. */
      }
      return true;
    } finally {
      clearInterval(timer);
      active = false;
    }
  }
  return {
    runOnce,
    async recoverPending(signal?: AbortSignal) {
      return { processed: (await runOnce(signal, 'recovery')) ? 1 : 0 };
    },
  };
}
