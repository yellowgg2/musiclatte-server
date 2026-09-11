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
  batchTimeMs: number;
  sweepIntervalMs: number;
  maxQueueItems: number;
  reconcile(trackRef: string, signal?: AbortSignal): Promise<void>;
}
/** Persistent BFS membership; unfinished items replay after a crash. No separate scan scheduler. */
export function createCurationInventory(options: CurationInventoryOptions) {
  const { database, repository, source, clock } = options;
  const db = database.connection;
  for (const value of [
    options.batchSize,
    options.batchTimeMs,
    options.sweepIntervalMs,
    options.maxQueueItems,
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > 86400000)
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
    db.prepare("INSERT INTO curation_inventory_queue VALUES(?,?,?,?,'pending')").run(
      libraryId,
      generation,
      id,
      kind,
    );
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
        clock() - Number(run.last_discovery_at ?? 0) >= options.sweepIntervalMs)
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
            "UPDATE curation_inventory_queue SET status='pending' WHERE library_id=? AND generation=? AND opaque_id=? AND kind='track'",
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
    if (pending) {
      try {
        if (pending.kind === 'directory') {
          const directory = await source.registrationDirectory(String(pending.opaque_id), {
            signal,
          });
          if (directory.id !== pending.opaque_id) throw new Error('inventory_upstream');
          database.transaction(() => {
            for (const child of directory.child)
              enqueue(library.id, generation, child.id, child.isDir);
            db.prepare(
              "UPDATE curation_inventory_queue SET status='done' WHERE library_id=? AND generation=? AND opaque_id=? AND kind='directory'",
            ).run(library.id, generation, pending.opaque_id!);
          });
        } else {
          const track = db
            .prepare('SELECT id FROM curation_tracks WHERE library_id=? AND track_id=?')
            .get(library.id, pending.opaque_id!)!;
          await options.reconcile(String(track.id), signal);
          db.prepare(
            "UPDATE curation_inventory_queue SET status='done' WHERE library_id=? AND generation=? AND opaque_id=? AND kind='track'",
          ).run(library.id, generation, pending.opaque_id!);
        }
      } catch (error) {
        if (signal.aborted) return false;
        db.prepare(
          "UPDATE curation_inventory_queue SET status='error' WHERE library_id=? AND generation=? AND opaque_id=? AND kind=?",
        ).run(library.id, generation, pending.opaque_id!, pending.kind!);
        markCoverage(
          library.id,
          'partial',
          error instanceof Error &&
            [
              'inventory_capacity',
              'unsupported_format',
              'inventory_pending',
              'file_unavailable',
              'revision_conflict',
            ].includes(error.message)
            ? error.message
            : 'inventory_upstream',
        );
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
    async runBatch(signal?: AbortSignal): Promise<{ processed: number }> {
      if (running || signal?.aborted || !options.libraries.length) return { processed: 0 };
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
          if (await step(library, controller.signal)) {
            processed++;
            idle = 0;
          } else idle++;
        }
        return { processed };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        running = false;
      }
    },
  };
}
