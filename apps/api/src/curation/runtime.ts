import { dirname, join } from 'node:path';
import { createMediaFence, mediaFenceRoot } from '../metadata/media-fence.js';
import { createMetadataFileAccess } from '../metadata/file-access.js';
import { createCurationRepository } from '../storage/curation-repository.js';
import { createCurationReconciler } from './reconciliation.js';
import { createCurationInventory } from './inventory.js';
import type { CurationRuntimePolicy } from '../automation/config.js';
import type { ManagementDatabase } from '../storage/database.js';
import type { MetadataOptions } from '../metadata/provider.js';
import type { SubsonicClient } from '../subsonic/client.js';
import type { createMetadataHelper } from '../metadata/helper-client.js';
export function configuredMediaFence(
  env: Record<string, string | undefined>,
  runtime: { python: string; helperPath: string; musicRoot: string; timeoutMs: number },
  privateRoots: readonly string[] = [],
) {
  const root = env.MEDIA_FENCE_ROOT;
  if (!root) throw new Error('invalid_fence');
  mediaFenceRoot(root);
  if (
    [runtime.musicRoot, ...privateRoots].some(
      (other) => root === other || root.startsWith(other + '/') || other.startsWith(root + '/'),
    )
  )
    throw new Error('invalid_fence');
  return createMediaFence({
    root,
    python: runtime.python,
    helperPath: join(dirname(runtime.helperPath), 'media_fence.py'),
    timeoutMs: runtime.timeoutMs,
  });
}
export function curationRuntimeReady(
  database: ManagementDatabase,
  libraryIds: readonly string[],
  clock: () => number,
) {
  const db = database.connection;
  const worker = db
    .prepare('SELECT status,heartbeat_at FROM metadata_worker_state WHERE singleton=1')
    .get();
  const age = clock() - Number(worker?.heartbeat_at ?? -1);
  if (
    !worker ||
    !['idle', 'working'].includes(String(worker.status)) ||
    age < 0 ||
    age >= 30000 ||
    !libraryIds.length
  )
    return false;
  return libraryIds.every((id) => {
    const row = db.prepare('SELECT status FROM curation_inventory_runs WHERE library_id=?').get(id);
    return row && ['discovering', 'partial', 'ready'].includes(String(row.status));
  });
}
export function createCurationScheduler(options: {
  database: ManagementDatabase;
  clock: () => number;
  signingKey: Uint8Array;
  policy: CurationRuntimePolicy;
  libraries: MetadataOptions['policy']['libraries'];
  source: Pick<SubsonicClient, 'inventoryIndexes' | 'registrationDirectory' | 'recentSong'>;
  helper: ReturnType<typeof createMetadataHelper>;
  runtime: MetadataOptions['runtime'];
  fence: ReturnType<typeof createMediaFence>;
}) {
  const repository = createCurationRepository({
    database: options.database,
    clock: options.clock,
    cursorKey: options.signingKey,
    limits: options.policy.limits,
  });
  const reconciler = createCurationReconciler({
    ...options,
    repository,
    fileAccess: createMetadataFileAccess({
      ...options.runtime,
      helperPath: join(dirname(options.runtime.helperPath), 'file_access.py'),
    }),
  });
  const inventory = createCurationInventory({
    ...options,
    ...options.policy.inventory,
    repository,
    reconcile: (id, signal) => reconciler.reconcile(id, signal),
  });
  return {
    repository,
    inventory,
    async cycle(signal: AbortSignal) {
      if (signal.aborted) return false;
      return (await inventory.runBatch(signal)).processed > 0;
    },
  };
}
