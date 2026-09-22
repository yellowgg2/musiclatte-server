import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, watch as watchFs, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { ManagementDatabase } from '../storage/database.js';
import { createExternalWatchRepository } from '../storage/external-watch-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { validateRelativeKey, type ImportLibrary } from './policy.js';
import { accountDirectoryForUsername } from './external-watch-config.js';
import { createExternalWatchInventory } from './external-watch-inventory.js';
import { createExternalWatchService } from './external-watch-service.js';
import { createExternalRegistrationService } from './external-registration-service.js';

export const externalWatchIntervals = Object.freeze({
  coalesceMs: 250,
  dueMs: 5_000,
  watcherRefreshMs: 60_000,
  safetyReconcileMs: 21_600_000,
});

interface WatchHandle {
  on(event: 'error', listener: () => void): unknown;
  close(): void;
}

interface InventoryBoundary {
  reconcile(target: {
    libraryId: string;
    relativeRoot: string;
    accountDirectory: string;
    identityKey: string;
  }): { status: 'complete' | 'progress' | 'blocked'; processed: number; failureCode?: string };
}

interface AdmissionBoundary {
  runOnce(signal?: AbortSignal): Promise<string>;
}

interface RegistrationBoundary {
  runOnce(signal?: AbortSignal): Promise<boolean>;
}

interface RuntimeMapping {
  key: string;
  instanceId: string;
  policyRevision: number;
  owners: Array<{
    libraryId: string;
    relativeRoot: string;
    accountDirectory: string;
    username: string;
    identityKey: string;
  }>;
}

interface ExternalWatchRuntimeOptions {
  database: ManagementDatabase;
  musicRoot: string;
  ffprobe: string;
  scanClient: Pick<
    SubsonicClient,
    'getScanStatus' | 'startScan' | 'indexes' | 'registrationDirectory'
  >;
  libraries: readonly ImportLibrary[];
  clock(): number;
  logger?: (event: Record<string, string | number>) => void;
  testing?: {
    inventory?: InventoryBoundary;
    createAdmission?: (mapping: RuntimeMapping) => AdmissionBoundary;
    registration?: RegistrationBoundary;
    watch?: (path: string, listener: () => void) => WatchHandle;
  };
}

function accountDirectoryPath(root: string, key: string): string {
  validateRelativeKey(key);
  if (realpathSync(root) !== root) throw new Error('invalid_external_watch_root');
  let current = root;
  for (const part of key.split('/')) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current)
      throw new Error('invalid_external_watch_root');
  }
  return current;
}

/** Serial idle-boundary scheduler; durable rows remain the source of truth across restarts. */
export function createExternalWatchRuntime(options: ExternalWatchRuntimeOptions) {
  const libraries = options.libraries.filter((library) => library.watchExternalMp3 === true);
  if (libraries.length === 0) throw new Error('invalid_external_watch_runtime');
  const repository = createExternalWatchRepository({
    database: options.database,
    clock: options.clock,
  });
  const inventory =
    options.testing?.inventory ??
    createExternalWatchInventory({
      database: options.database,
      musicRoot: options.musicRoot,
      clock: options.clock,
    });
  const registration =
    options.testing?.registration ??
    createExternalRegistrationService({
      database: options.database,
      musicRoot: options.musicRoot,
      scanClient: options.scanClient,
      libraries,
      clock: options.clock,
    });
  const watch =
    options.testing?.watch ??
    ((path: string, listener: () => void): FSWatcher =>
      watchFs(path, { persistent: false, recursive: true }, listener));
  const emit = (event: Record<string, string | number>) => {
    try {
      options.logger?.(event);
    } catch {
      // Diagnostics cannot change scheduling or durable state.
    }
  };
  const now = () => {
    const value = options.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_external_watch_clock');
    return value;
  };
  const watchers = new Map<string, WatchHandle>();
  const nextInventory = new Map<string, number>();
  let mapping: RuntimeMapping | null = null;
  let admission: AdmissionBoundary | null = null;
  let nextConfigAt = 0;
  let nextWatcherRefreshAt = 0;
  let nextAdmissionAt = 0;
  let nextRegistrationAt = 0;
  let closed = false;

  const ownerKey = (libraryId: string, accountDirectory: string) =>
    `${libraryId}\0${accountDirectory}`;
  const closeWatchers = () => {
    for (const watcher of watchers.values()) {
      try {
        watcher.close();
      } catch {
        // A failed close does not make durable work unsafe.
      }
    }
    watchers.clear();
  };
  const readMapping = (at: number): RuntimeMapping | null => {
    if (at < nextConfigAt) return mapping;
    nextConfigAt = at + externalWatchIntervals.dueMs;
    const expected = libraries
      .flatMap((library) =>
        library.allowedUsers.map((username) => ({
          libraryId: library.id,
          relativeRoot: library.relativeRoot,
          accountDirectory: accountDirectoryForUsername(username),
          username,
        })),
      )
      .sort((a, b) =>
        ownerKey(a.libraryId, a.accountDirectory).localeCompare(
          ownerKey(b.libraryId, b.accountDirectory),
        ),
      );
    const stored = repository.listOwners();
    const instanceIds = new Set(stored.map((owner) => owner.instanceId));
    const revisions = new Set(stored.map((owner) => owner.policyRevision));
    const storedByKey = new Map(
      stored.map((owner) => [ownerKey(owner.libraryId, owner.accountDirectory), owner]),
    );
    const owners = expected.flatMap((owner) => {
      const projected = storedByKey.get(ownerKey(owner.libraryId, owner.accountDirectory));
      return projected && projected.username === owner.username
        ? [{ ...owner, identityKey: projected.identityKey }]
        : [];
    });
    if (
      owners.length !== expected.length ||
      stored.length !== expected.length ||
      instanceIds.size !== 1 ||
      revisions.size !== 1
    ) {
      if (mapping !== null || nextConfigAt === at + externalWatchIntervals.dueMs)
        emit({ event: 'external_watch_config', failureCode: 'config_mismatch' });
      mapping = null;
      admission = null;
      closeWatchers();
      return null;
    }
    const instanceId = [...instanceIds][0]!;
    const policyRevision = [...revisions][0]!;
    const key = JSON.stringify([
      instanceId,
      policyRevision,
      owners.map((owner) => [owner.libraryId, owner.accountDirectory, owner.username]),
      owners.map((owner) => owner.identityKey),
    ]);
    if (mapping?.key !== key) {
      mapping = { key, instanceId, policyRevision, owners };
      admission = options.testing?.createAdmission
        ? options.testing.createAdmission(mapping)
        : createExternalWatchService({
            database: options.database,
            musicRoot: options.musicRoot,
            ffprobe: options.ffprobe,
            timeoutMs: 60_000,
            clock: options.clock,
            workerId: randomUUID(),
            instanceId,
            policyRevision,
            expectedOwners: owners.map(({ libraryId, accountDirectory, username }) => ({
              libraryId,
              accountDirectory,
              username,
            })),
          });
      closeWatchers();
      nextWatcherRefreshAt = at;
      for (const owner of owners)
        if (!nextInventory.has(ownerKey(owner.libraryId, owner.accountDirectory)))
          nextInventory.set(ownerKey(owner.libraryId, owner.accountDirectory), at);
    }
    return mapping;
  };
  const refreshWatchers = (active: RuntimeMapping, at: number) => {
    if (at < nextWatcherRefreshAt) return;
    nextWatcherRefreshAt = at + externalWatchIntervals.watcherRefreshMs;
    for (const owner of active.owners) {
      const key = ownerKey(owner.libraryId, owner.accountDirectory);
      if (watchers.has(key)) continue;
      try {
        const path = accountDirectoryPath(
          options.musicRoot,
          `${owner.relativeRoot}/${owner.accountDirectory}`,
        );
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        const watcher = watch(path, () => {
          if (closed) return;
          const due = now() + externalWatchIntervals.coalesceMs;
          nextInventory.set(key, Math.min(nextInventory.get(key) ?? due, due));
        });
        watcher.on('error', () => {
          try {
            watcher.close();
          } catch {
            // Periodic reconciliation remains available.
          }
          watchers.delete(key);
          const due = now() + externalWatchIntervals.coalesceMs;
          nextInventory.set(key, Math.min(nextInventory.get(key) ?? due, due));
          nextWatcherRefreshAt = Math.min(
            nextWatcherRefreshAt,
            now() + externalWatchIntervals.watcherRefreshMs,
          );
          emit({ event: 'external_watch_listener', failureCode: 'watch_unavailable' });
        });
        watchers.set(key, watcher);
      } catch {
        // Missing/unsupported roots are retried on the fixed reconciliation boundary.
      }
    }
  };
  const externalRegistrationDue = (at: number) =>
    Boolean(
      options.database.connection
        .prepare(
          `SELECT 1 FROM external_file_observations
           WHERE state='registering' AND next_attempt_at<=?
             AND (lease_expires_at IS NULL OR lease_expires_at<=?) LIMIT 1`,
        )
        .get(at, at),
    );

  return {
    async runOnce(signal = new AbortController().signal): Promise<boolean> {
      if (closed || signal.aborted) return false;
      const at = now();
      const active = readMapping(at);
      if (!active) return false;
      refreshWatchers(active, at);
      const target = active.owners.find(
        (owner) =>
          (nextInventory.get(ownerKey(owner.libraryId, owner.accountDirectory)) ?? at) <= at,
      );
      if (target) {
        const key = ownerKey(target.libraryId, target.accountDirectory);
        try {
          const result = inventory.reconcile(target);
          const blockedRetry =
            result.status === 'blocked'
              ? repository.getRoot(target.libraryId, target.accountDirectory)?.nextReconcileAt
              : undefined;
          nextInventory.set(
            key,
            result.status === 'progress'
              ? at
              : result.status === 'blocked'
                ? (blockedRetry ?? at + externalWatchIntervals.watcherRefreshMs)
                : at + externalWatchIntervals.safetyReconcileMs,
          );
          emit({ event: 'external_watch_inventory', count: result.processed });
        } catch {
          nextInventory.set(key, at + externalWatchIntervals.watcherRefreshMs);
          emit({ event: 'external_watch_inventory', failureCode: 'inventory_unavailable' });
        }
        return true;
      }
      if (at >= nextAdmissionAt) {
        nextAdmissionAt = at + externalWatchIntervals.dueMs;
        try {
          const result = await admission!.runOnce(signal);
          if (result !== 'idle' && result !== 'config_mismatch') {
            if (result === 'admitted') nextRegistrationAt = at;
            emit({ event: 'external_watch_admission', count: 1 });
            return true;
          }
          if (result === 'config_mismatch')
            emit({ event: 'external_watch_config', failureCode: 'config_mismatch' });
        } catch {
          if (!signal.aborted)
            emit({ event: 'external_watch_admission', failureCode: 'admission_unavailable' });
        }
      }
      if (at >= nextRegistrationAt && externalRegistrationDue(at)) {
        nextRegistrationAt = at + externalWatchIntervals.dueMs;
        try {
          const worked = await registration.runOnce(signal);
          if (worked) {
            emit({ event: 'external_watch_registration', count: 1 });
            return true;
          }
        } catch {
          if (!signal.aborted)
            emit({ event: 'external_watch_registration', failureCode: 'registration_unavailable' });
        }
      }
      return false;
    },
    async close() {
      if (closed) return;
      closed = true;
      closeWatchers();
    },
  };
}
