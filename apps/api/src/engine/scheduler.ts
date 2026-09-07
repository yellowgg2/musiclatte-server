import {
  engineFailureCodes,
  type EngineFailure,
  type createEngineRepository,
} from '../storage/engine-repository.js';
import type { EngineCandidate, EngineStore } from './engine-store.js';
import type { EngineUpdater } from './updater.js';

export function engineFailure(error: unknown, fallback: EngineFailure): EngineFailure {
  return error instanceof Error && engineFailureCodes.some((code) => code === error.message)
    ? (error.message as EngineFailure)
    : fallback;
}
/** The caller owns scheduling/timer lifetime; persisted claims collapse missed intervals to one attempt. */
export function createEngineScheduler(options: {
  repository: ReturnType<typeof createEngineRepository>;
  store: EngineStore;
  updater: EngineUpdater;
}) {
  const { repository, store, updater } = options;
  return {
    async checkDue(signal?: AbortSignal): Promise<boolean> {
      signal?.throwIfAborted();
      const token = repository.claim('check');
      if (!token) return false;
      let candidate: EngineCandidate | null = null;
      let retained = false;
      try {
        const pointer = store.readPointer();
        if (!pointer) throw new Error('invalid_executable');
        candidate = await updater.prepareCandidate(pointer.active, signal);
        repository.assertOwned(token);
        repository.finishCheck(token, candidate ?? undefined);
        retained = candidate !== null;
        return true;
      } catch (error) {
        const code = engineFailure(error, 'update_failed');
        // A stale process may clean only its own candidate; it cannot publish a result.
        repository.assertOwned(token);
        repository.fail(
          token,
          code === 'update_failed' ? 'update_failed' : 'validation_failed',
          code,
        );
        return true;
      } finally {
        try {
          if (candidate && !retained) store.removeCandidate(candidate.key);
        } finally {
          repository.unlock(token);
        }
      }
    },
  };
}
