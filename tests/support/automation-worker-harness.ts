import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMetadataRepository } from '../../apps/api/src/storage/metadata-repository.js';
import { createMetadataFileStore } from '../../apps/api/src/metadata/file-store.js';
import { createMetadataWorker } from '../../apps/api/src/metadata/worker.js';
import { createMetadataJobAuthorizer } from '../../apps/api/src/auth/metadata-job-authorizer.js';
import { createMediaPublicationLedger } from '../../apps/api/src/metadata/media-fence.js';
import { createMetadataRevision } from '../../apps/api/src/metadata/revision.js';
import type { createCurationMutationContext } from './curation-mutation-harness.js';
export function createAutomationTestWorker(
  c: Awaited<ReturnType<typeof createCurationMutationContext>>,
  reflect = false,
) {
  const privateRoot = join(realpathSync(c.storage.root), 'metadata-private');
  mkdirSync(privateRoot, { mode: 0o700 });
  const repository = createMetadataRepository({ database: c.storage.db, clock: c.clock });
  const fileStore = createMetadataFileStore({
    ...c.metadata.runtime,
    musicRoot: c.musicRoot,
    privateRoot,
    lockRoot: c.lockRoot,
    publications: createMediaPublicationLedger(c.storage.db, c.clock),
    helperPath: resolve('apps/api/helpers/file_transaction.py'),
  });
  const authorizer = createMetadataJobAuthorizer(c.automation);
  const revisions = createMetadataRevision(c.options.signingKey);
  const worker = createMetadataWorker({
    repository,
    fileStore,
    workerId: 'synthetic-automation-worker',
    leaseDurationMs: 10000,
    authorize: async (work) => {
      if (work.actorTokenId) authorizer.authorizeAcceptedWork(work);
      return { preserveOwnership: true };
    },
    revision: (work, digest) =>
      revisions.fileRevision({ libraryId: work.libraryId, relativeFileKey: work.key, digest }),
    ...(reflect
      ? {
          reflect: async (claim, work) => {
            // Synthetic index reflection is explicit. The runtime probe owns actual gonic verification.
            repository.transition({ ...claim, stage: 'reflecting' });
            repository.recordReflection(claim, {
              status: 'verified',
              evidence: { synthetic: true },
              relatedIds: {
                trackIds: [work.trackId],
                albumIds: [],
                artistIds: [],
                coverIds: [],
              },
            });
          },
        }
      : {}),
  });
  return { worker, repository, fileStore };
}
