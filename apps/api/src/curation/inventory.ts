import { randomUUID } from 'node:crypto';
import type { ManagementDatabase } from '../storage/database.js';
import type { CurationRepository } from '../storage/curation-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';

export interface CurationInventoryOptions {
  database: ManagementDatabase;
  repository: CurationRepository;
  source: Pick<SubsonicClient, 'inventoryIndexes' | 'registrationDirectory'>;
  clock(): number;
  libraries: readonly { id: string; musicFolderId: string }[];
  batchSize: number;
  itemTimeoutMs?: number;
  batchTimeMs: number;
  retryIntervalMs?: number;
  maxRetryAttempts?: number;
  sweepIntervalMs: number;
  maxQueueItems: number;
  reconcile(trackRef: string, signal?: AbortSignal): Promise<void>;
  reportFailure?(failure: {
    kind: 'directory' | 'track';
    code: string;
    cause: 'item_timeout' | 'upstream';
  }): void;
}
export interface CurationInventoryBatchSummary {
  processed: number;
  succeeded: number;
  retryScheduled: number;
  terminal: number;
}
/** Persistent BFS membership; unfinished items replay after a crash. No separate scan scheduler. */
export function createCurationInventory(options: CurationInventoryOptions) {
  const { database, repository, source, clock } = options;
  const db = database.connection;
  const itemTimeoutMs = options.itemTimeoutMs ?? options.batchTimeMs;
  const retryIntervalMs = options.retryIntervalMs ?? 1;
  const maxRetryAttempts = options.maxRetryAttempts ?? 0;
  const bounded = {
    batchSize: [options.batchSize, 100],
    itemTimeoutMs: [itemTimeoutMs, 120000],
    batchTimeMs: [options.batchTimeMs, 300000],
    retryIntervalMs: [retryIntervalMs, 86400000],
    sweepIntervalMs: [options.sweepIntervalMs, 86400000],
    maxQueueItems: [options.maxQueueItems, 1000000],
  } as const;
  for (const [value, max] of Object.values(bounded))
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error('invalid_inventory_config');
  if (
    !Number.isSafeInteger(maxRetryAttempts) ||
    maxRetryAttempts < 0 ||
    maxRetryAttempts > 10 ||
    itemTimeoutMs > options.batchTimeMs ||
    options.sweepIntervalMs < options.batchTimeMs
  )
    throw new Error('invalid_inventory_config');
  let running = false;
  let offset = 0;
  function enqueue(libraryId: string, generation: string, id: string, isDir: boolean) {
    if (!id || id.length > 2048) throw new Error('inventory_upstream');
    const kind = isDir ? 'directory' : 'track';
    if (
      db
        .prepare(
          'SELECT 1 FROM curation_inventory_queue WHERE library_id=? AND generation=? AND kind=? AND opaque_id=?',
        )
        .get(libraryId, generation, kind, id)
    )
      return;
    if (
      Number(
        db
          .prepare('SELECT count(*) AS n FROM curation_inventory_queue WHERE library_id=?')
          .get(libraryId)!.n,
      ) >= options.maxQueueItems
    )
      throw new Error('inventory_capacity');
    db.prepare(
      "INSERT INTO curation_inventory_queue(library_id,generation,opaque_id,kind,status) VALUES(?,?,?,?,'pending')",
    ).run(libraryId, generation, id, kind);
    if (!isDir) repository.discover({ libraryId, trackId: id, format: 'unsupported' });
  }
  function markCoverage(
    libraryId: string,
    status: 'discovering' | 'partial' | 'ready' | 'stale' | 'error',
    error: string | null = null,
  ) {
    db.prepare(
      'UPDATE curation_inventory_runs SET status=?,last_error_code=? WHERE library_id=?',
    ).run(status, error, libraryId);
  }
  async function step(
    library: { id: string; musicFolderId: string },
    signal: AbortSignal,
    externalSignal?: AbortSignal,
    summary: CurationInventoryBatchSummary = {
      processed: 0,
      succeeded: 0,
      retryScheduled: 0,
      terminal: 0,
    },
  ): Promise<boolean> {
    let run = db
      .prepare('SELECT * FROM curation_inventory_runs WHERE library_id=?')
      .get(library.id);
    const priorCheckpoint = run
      ? (JSON.parse(String(run.checkpoint_json)) as { discoveryComplete?: boolean })
      : {};
    if (
      !run ||
      run.status === 'stale' ||
      ((['ready', 'error'].includes(String(run.status)) ||
        (run.status === 'partial' && priorCheckpoint.discoveryComplete === true)) &&
        clock() - Number(run.last_reconciled_at ?? run.last_discovery_at ?? 0) >=
          options.sweepIntervalMs)
    ) {
      const generation = randomUUID();
      database.transaction(() => {
        db.prepare('DELETE FROM curation_inventory_queue WHERE library_id=?').run(library.id);
        db.prepare(
          "INSERT INTO curation_inventory_runs(library_id,generation,status,last_discovery_at,checkpoint_json) VALUES(?,?,'discovering',?,'{}') ON CONFLICT(library_id) DO UPDATE SET generation=excluded.generation,status='discovering',last_discovery_at=excluded.last_discovery_at,last_error_code=NULL,checkpoint_json='{}'",
        ).run(library.id, generation, clock());
      });
      run = db.prepare('SELECT * FROM curation_inventory_runs WHERE library_id=?').get(library.id)!;
    }
    const generation = String(run.generation);
    const checkpoint = JSON.parse(String(run.checkpoint_json)) as {
      rootsLoaded?: boolean;
      discoveryComplete?: boolean;
    };
    if (!checkpoint.rootsLoaded) {
      if (run.status === 'error') return false;
      try {
        const indexes = await source.inventoryIndexes(library.musicFolderId, { signal });
        database.transaction(() => {
          for (const root of indexes.roots) enqueue(library.id, generation, root.id, root.isDir);
          db.prepare(
            'UPDATE curation_inventory_runs SET checkpoint_json=? WHERE library_id=? AND generation=?',
          ).run(
            JSON.stringify({ rootsLoaded: true, sourceGeneration: indexes.lastModified ?? null }),
            library.id,
            generation,
          );
        });
      } catch (error) {
        if (signal.aborted) return false;
        markCoverage(
          library.id,
          'error',
          error instanceof Error && error.message === 'inventory_capacity'
            ? error.message
            : 'inventory_upstream',
        );
      }
      return true;
    }
    const event = db
      .prepare(
        'SELECT * FROM curation_source_events WHERE library_id=? AND sequence>? ORDER BY sequence LIMIT 1',
      )
      .get(library.id, run.event_sequence!);
    if (event) {
      database.transaction(() => {
        if (event.track_id) {
          enqueue(library.id, generation, String(event.track_id), false);
          db.prepare(
            'UPDATE curation_tracks SET source_sequence=? WHERE library_id=? AND track_id=? AND source_sequence<?',
          ).run(event.sequence!, library.id, event.track_id!, event.sequence!);
          db.prepare(
            "UPDATE curation_inventory_queue SET status='pending',attempt_count=0,next_attempt_at=NULL,last_error_code=NULL,terminal=0 WHERE library_id=? AND generation=? AND opaque_id=? AND kind='track'",
          ).run(library.id, generation, event.track_id!);
        }
        db.prepare('UPDATE curation_inventory_runs SET event_sequence=? WHERE library_id=?').run(
          event.sequence!,
          library.id,
        );
      });
      return true;
    }
    const pending = db
      .prepare(
        "SELECT q.* FROM curation_inventory_queue q LEFT JOIN curation_tracks t ON q.kind='track' AND t.library_id=q.library_id AND t.track_id=q.opaque_id WHERE q.library_id=? AND q.generation=? AND q.status='pending' ORDER BY CASE q.kind WHEN 'track' THEN 0 ELSE 1 END,COALESCE(t.source_sequence,0) DESC,q.opaque_id COLLATE BINARY LIMIT 1",
      )
      .get(library.id, generation);
    const queued =
      pending ??
      db
        .prepare(
          "SELECT q.* FROM curation_inventory_queue q LEFT JOIN curation_tracks t ON q.kind='track' AND t.library_id=q.library_id AND t.track_id=q.opaque_id WHERE q.library_id=? AND q.generation=? AND q.status='error' AND q.terminal=0 AND q.next_attempt_at<=? ORDER BY CASE q.kind WHEN 'track' THEN 0 ELSE 1 END,COALESCE(t.source_sequence,0) DESC,q.opaque_id COLLATE BINARY LIMIT 1",
        )
        .get(library.id, generation, clock());
    if (queued) {
      let abortReason: 'item_timeout' | 'batch_budget' | null = null;
      const itemController = new AbortController();
      const abortForBatch = () => {
        if (!abortReason) abortReason = 'batch_budget';
        itemController.abort();
      };
      signal.addEventListener('abort', abortForBatch, { once: true });
      const itemTimer = setTimeout(() => {
        if (!abortReason) abortReason = 'item_timeout';
        itemController.abort();
      }, itemTimeoutMs);
      try {
        if (queued.kind === 'directory') {
          const directory = await source.registrationDirectory(String(queued.opaque_id), {
            signal: itemController.signal,
          });
          if (directory.id !== queued.opaque_id) throw new Error('inventory_upstream');
          database.transaction(() => {
            for (const child of directory.child)
              enqueue(library.id, generation, child.id, child.isDir);
            db.prepare(
              "UPDATE curation_inventory_queue SET status='done' WHERE library_id=? AND generation=? AND opaque_id=? AND kind='directory'",
            ).run(library.id, generation, queued.opaque_id!);
            db.prepare(
              'UPDATE curation_inventory_failures SET resolved_at=? WHERE library_id=? AND kind=? AND opaque_id=?',
            ).run(clock(), library.id, queued.kind!, queued.opaque_id!);
          });
        } else {
          const track = db
            .prepare('SELECT id FROM curation_tracks WHERE library_id=? AND track_id=?')
            .get(library.id, queued.opaque_id!)!;
          await options.reconcile(String(track.id), itemController.signal);
          database.transaction(() => {
            db.prepare(
              "UPDATE curation_inventory_queue SET status='done' WHERE library_id=? AND generation=? AND opaque_id=? AND kind='track'",
            ).run(library.id, generation, queued.opaque_id!);
            db.prepare(
              'UPDATE curation_inventory_failures SET resolved_at=? WHERE library_id=? AND kind=? AND opaque_id=?',
            ).run(clock(), library.id, queued.kind!, queued.opaque_id!);
          });
        }
        summary.succeeded++;
      } catch (error) {
        if (abortReason === 'batch_budget' || (signal.aborted && externalSignal?.aborted))
          return false;
        const code =
          error instanceof Error &&
          [
            'inventory_capacity',
            'unsupported_format',
            'inventory_pending',
            'file_unavailable',
            'revision_conflict',
          ].includes(error.message)
            ? error.message
            : 'inventory_upstream';
        const attemptCount = Number(queued.attempt_count ?? 0) + 1;
        const terminal = attemptCount > maxRetryAttempts;
        const cause = abortReason === 'item_timeout' ? 'item_timeout' : 'upstream';
        database.transaction(() => {
          db.prepare(
            "UPDATE curation_inventory_queue SET status='error',attempt_count=?,next_attempt_at=?,last_error_code=?,terminal=? WHERE library_id=? AND generation=? AND opaque_id=? AND kind=?",
          ).run(
            attemptCount,
            terminal ? null : clock() + retryIntervalMs,
            code,
            terminal ? 1 : 0,
            library.id,
            generation,
            queued.opaque_id!,
            queued.kind!,
          );
          db.prepare(
            `INSERT INTO curation_inventory_failures(library_id,kind,opaque_id,failure_count,last_error_code,last_cause,first_failed_at,last_failed_at,resolved_at)
             VALUES(?,?,?,1,?,?,?,?,NULL)
             ON CONFLICT(library_id,kind,opaque_id) DO UPDATE SET failure_count=failure_count+1,last_error_code=excluded.last_error_code,last_cause=excluded.last_cause,last_failed_at=excluded.last_failed_at,resolved_at=NULL`,
          ).run(library.id, queued.kind!, queued.opaque_id!, code, cause, clock(), clock());
          markCoverage(library.id, 'partial', code);
        });
        if (terminal) summary.terminal++;
        else summary.retryScheduled++;
        options.reportFailure?.({
          kind: queued.kind === 'directory' ? 'directory' : 'track',
          code,
          cause,
        });
      } finally {
        clearTimeout(itemTimer);
        signal.removeEventListener('abort', abortForBatch);
      }
      return true;
    }
    const errors = Number(
      db
        .prepare(
          "SELECT count(*) AS n FROM curation_inventory_queue WHERE library_id=? AND generation=? AND status='error'",
        )
        .get(library.id, generation)!.n,
    );
    if (run.status === 'ready' || (run.status === 'partial' && checkpoint.discoveryComplete))
      return false;
    database.transaction(() => {
      if (!errors) {
        db.prepare(
          "UPDATE curation_tracks SET tombstoned=1,validation='stale',base_status=CASE base_status WHEN 'completed' THEN 'needs_review' ELSE base_status END WHERE library_id=? AND track_id NOT IN (SELECT opaque_id FROM curation_inventory_queue WHERE library_id=? AND generation=? AND kind='track')",
        ).run(library.id, library.id, generation);
      }
      db.prepare(
        'UPDATE curation_inventory_runs SET status=?,last_reconciled_at=?,checkpoint_json=? WHERE library_id=?',
      ).run(
        errors ? 'partial' : 'ready',
        clock(),
        JSON.stringify({ ...checkpoint, discoveryComplete: true }),
        library.id,
      );
    });
    return true;
  }
  return {
    markCoverage,
    async runBatch(signal?: AbortSignal): Promise<CurationInventoryBatchSummary> {
      const summary: CurationInventoryBatchSummary = {
        processed: 0,
        succeeded: 0,
        retryScheduled: 0,
        terminal: 0,
      };
      if (running || signal?.aborted || !options.libraries.length) return summary;
      running = true;
      const deadline = Date.now() + options.batchTimeMs;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), options.batchTimeMs);
      let processed = 0;
      try {
        let idle = 0;
        while (
          !controller.signal.aborted &&
          processed < options.batchSize &&
          Date.now() < deadline &&
          idle < options.libraries.length
        ) {
          const library = options.libraries[offset++ % options.libraries.length]!;
          if (await step(library, controller.signal, signal, summary)) {
            processed++;
            summary.processed = processed;
            idle = 0;
          } else idle++;
        }
        return summary;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        running = false;
      }
    },
  };
}
