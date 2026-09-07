import type { ManagementDatabase } from '../storage/database.js';
import { createEngineRequestRepository } from '../storage/engine-request-repository.js';
import type { EngineProvider } from './provider.js';

/** Deployment owns the timer and shutdown. HTTP only writes the mailbox and never imports this worker. */
export function createEngineRequestWorker(options: {
  database: ManagementDatabase;
  clock: () => number;
  provider: EngineProvider;
}) {
  const repository = createEngineRequestRepository(options);
  return {
    async processNext(signal?: AbortSignal): Promise<boolean> {
      signal?.throwIfAborted();
      const request = repository.claim();
      if (!request) return false;
      try {
        // Recover a manifest commit that preceded an interrupted DB projection.
        await options.provider.initialize();
        signal?.throwIfAborted();
        if (request.action === 'check_now') await options.provider.checkDue(signal);
        else await options.provider.restorePrevious(request);
        repository.finish(request.owner, 'completed');
      } catch (error) {
        const retry =
          signal?.aborted ||
          (error instanceof Error && ['engine_busy', 'engine_claim_lost'].includes(error.message));
        // Raw process/file errors never enter the durable receipt or API projection.
        repository.finish(request.owner, retry ? 'pending' : 'failed');
      }
      return true;
    },
  };
}
