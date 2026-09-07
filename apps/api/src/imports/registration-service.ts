import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagementDatabase } from '../storage/database.js';
import type { SubsonicClient } from '../subsonic/client.js';
import type { RegistrationDirectory } from '../subsonic/protocol.js';
import { validateRelativeKey } from './policy.js';

export interface RegistrationOptions {
  database: ManagementDatabase;
  /** Fixed worker-only token client, injected by the worker runtime, never a session client. */
  scanClient: Pick<
    SubsonicClient,
    'getScanStatus' | 'startScan' | 'indexes' | 'registrationDirectory'
  >;
  libraries: readonly { id: string; musicFolderId: string; relativeRoot: string }[];
  clock: () => number;
  timeoutMs?: number;
  pollMs?: number;
  retryMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
interface PendingItem {
  id: string;
  mediaId: string;
  libraryId: string;
  fileKey: string;
}
type Failure =
  | 'registration_pending'
  | 'registration_timeout'
  | 'registration_upstream'
  | 'registration_path'
  | 'registration_ambiguous'
  | 'registration_cancelled'
  | 'registration_conflict';
class RegistrationFailure extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}
function normalizePath(path: string): string {
  if (
    !path ||
    posix.isAbsolute(path) ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.split('/').includes('..')
  )
    throw new RegistrationFailure('registration_path');
  try {
    return validateRelativeKey(posix.normalize(path));
  } catch {
    throw new RegistrationFailure('registration_path');
  }
}

/** Inert until runOnce; bounded, durable, single-cycle scheduling over published items only. */
export function createRegistrationService(options: RegistrationOptions) {
  const { database, scanClient } = options;
  const db = database.connection;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 1000;
  const retryMs = options.retryMs ?? 30_000;
  for (const value of [timeoutMs, pollMs, retryMs])
    if (!Number.isSafeInteger(value) || value <= 0 || value > 3_600_000)
      throw new Error('invalid_registration_config');
  if (pollMs > timeoutMs) throw new Error('invalid_registration_config');
  const libraries = new Map(
    options.libraries.map((library) => {
      validateRelativeKey(library.relativeRoot);
      if (!library.id || !library.musicFolderId) throw new Error('invalid_registration_config');
      return [library.id, { ...library }] as const;
    }),
  );
  if (libraries.size !== options.libraries.length) throw new Error('invalid_registration_config');
  const now = () => {
    const at = options.clock();
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + 10_000_000))
      throw new Error('invalid_registration_clock');
    return at;
  };
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const registerPending = async (
    external?: AbortSignal,
  ): Promise<Array<{ itemId: string; status: 'ready' | 'registration_pending' }>> => {
    if (external?.aborted) return [];
    const owner = randomUUID();
    const items = database.transaction(() => {
      const at = now();
      const lock = db.prepare('SELECT * FROM registration_cycle WHERE singleton=1').get()!;
      if (Number(lock.expires_at) > at || Number(lock.next_scan_at) > at) return [];
      const job = db
        .prepare(
          "SELECT i.job_id FROM import_items i JOIN import_jobs j ON j.id=i.job_id LEFT JOIN registration_attempts r ON r.item_id=i.id WHERE i.stage='registering' AND (i.lease_owner IS NULL OR i.lease_expires_at<=?) AND COALESCE(r.next_attempt_at,0)<=? ORDER BY j.created_at,i.item_order LIMIT 1",
        )
        .get(at, at);
      if (!job) return [];
      const rows = db
        .prepare(
          "SELECT i.id,i.media_link_id,j.library_id,m.relative_file_key FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=i.media_link_id AND m.library_id=j.library_id LEFT JOIN registration_attempts r ON r.item_id=i.id WHERE i.job_id=? AND i.stage='registering' AND (i.lease_owner IS NULL OR i.lease_expires_at<=?) AND COALESCE(r.next_attempt_at,0)<=? ORDER BY i.item_order",
        )
        .all(job.job_id!, at, at);
      if (!rows.length) return [];
      const expires = at + timeoutMs + 1000;
      db.prepare(
        'UPDATE registration_cycle SET owner=?,expires_at=?,next_scan_at=? WHERE singleton=1',
      ).run(owner, expires, expires + retryMs);
      return rows.map((row) => {
        const item = {
          id: String(row.id),
          mediaId: String(row.media_link_id),
          libraryId: String(row.library_id),
          fileKey: String(row.relative_file_key),
        };
        db.prepare(
          "INSERT INTO registration_attempts(item_id,attempt,next_attempt_at,failure_code) VALUES(?,1,?,'registration_pending') ON CONFLICT(item_id) DO UPDATE SET attempt=attempt+1,next_attempt_at=excluded.next_attempt_at,failure_code=excluded.failure_code",
        ).run(item.id, expires + retryMs);
        return item;
      });
    });
    if (!items.length) return [];
    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const signal = controller.signal;
    const deadline = now() + timeoutMs;
    const owned = () => {
      signal.throwIfAborted();
      if (
        now() >= deadline ||
        !db
          .prepare(
            'SELECT 1 FROM registration_cycle WHERE singleton=1 AND owner=? AND expires_at>?',
          )
          .get(owner, now())
      )
        throw new RegistrationFailure('registration_timeout');
    };
    const pending = new Map(items.map((item) => [item.id, item]));
    const failures = new Map<string, Failure>();
    const complete = (item: PendingItem, songId: string) =>
      database.transaction(() => {
        owned();
        const current = db
          .prepare(
            "SELECT 1 FROM import_items i JOIN media_links m ON m.id=i.media_link_id JOIN import_jobs j ON j.id=i.job_id WHERE i.id=? AND i.stage='registering' AND m.id=? AND m.relative_file_key=? AND m.library_id=? AND j.library_id=m.library_id",
          )
          .get(item.id, item.mediaId, item.fileKey, item.libraryId);
        if (!current) throw new RegistrationFailure('registration_conflict');
        const at = now();
        db.prepare(
          "UPDATE media_links SET gonic_song_id=?,availability='available',revision=revision+1,validated_at=? WHERE id=?",
        ).run(songId, at, item.mediaId);
        const event = db
          .prepare(
            'UPDATE download_events SET registered_at=? WHERE import_item_id=? AND registered_at IS NULL',
          )
          .run(at, item.id);
        if (event.changes !== 1) throw new RegistrationFailure('registration_conflict');
        db.prepare(
          "UPDATE import_items SET stage='ready',ready_at=?,stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
        ).run(at, at, item.id);
        db.prepare('DELETE FROM registration_attempts WHERE item_id=?').run(item.id);
      });
    try {
      owned();
      if (!(await scanClient.getScanStatus({ signal })).scanning) {
        owned();
        await scanClient.startScan({ signal });
      }
      for (let round = 0; round <= Math.ceil(timeoutMs / pollMs) && pending.size; round++) {
        owned();
        if (!(await scanClient.getScanStatus({ signal })).scanning) {
          // Cache only a visibility round: delayed entries must be observable on the next round.
          const roots = new Map<string, Awaited<ReturnType<SubsonicClient['indexes']>>>();
          const directories = new Map<string, RegistrationDirectory>();
          const directory = async (id: string) => {
            owned();
            let result = directories.get(id);
            if (!result) {
              result = await scanClient.registrationDirectory(id, { signal });
              if (result.id !== id) throw new RegistrationFailure('registration_path');
              directories.set(id, result);
            }
            return result;
          };
          for (const item of pending.values()) {
            try {
              owned();
              const library = libraries.get(item.libraryId);
              if (!library || !item.fileKey.startsWith(library.relativeRoot + '/'))
                throw new RegistrationFailure('registration_path');
              validateRelativeKey(item.fileKey);
              const parts = item.fileKey.split('/');
              let index = roots.get(library.musicFolderId);
              if (!index) {
                index = await scanClient.indexes(library.musicFolderId, { signal });
                roots.set(library.musicFolderId, index);
              }
              const root = index.index
                .flatMap((group) => group.artist)
                .filter((artist) => artist.name === parts[0]);
              if (root.length !== 1)
                throw new RegistrationFailure(
                  root.length ? 'registration_ambiguous' : 'registration_pending',
                );
              let branch = root[0]!.id;
              for (const segment of parts.slice(1, -1)) {
                const children = (await directory(branch)).child.filter(
                  (child) => child.isDir && child.name === segment,
                );
                if (children.length !== 1)
                  throw new RegistrationFailure(
                    children.length ? 'registration_ambiguous' : 'registration_pending',
                  );
                branch = children[0]!.id;
              }
              const matches = (await directory(branch)).child.filter(
                (child) => !child.isDir && normalizePath(child.path) === item.fileKey,
              );
              if (matches.length !== 1)
                throw new RegistrationFailure(
                  matches.length ? 'registration_ambiguous' : 'registration_pending',
                );
              complete(item, matches[0]!.id);
              pending.delete(item.id);
            } catch (error) {
              failures.set(
                item.id,
                error instanceof RegistrationFailure ? error.code : 'registration_upstream',
              );
            }
          }
        }
        if (pending.size) await wait(Math.min(pollMs, Math.max(1, deadline - now())), signal);
      }
    } catch (error) {
      const failure: Failure = external?.aborted
        ? 'registration_cancelled'
        : signal.aborted || now() >= deadline
          ? 'registration_timeout'
          : error instanceof RegistrationFailure
            ? error.code
            : 'registration_upstream';
      for (const item of pending.values())
        if (!failures.has(item.id)) failures.set(item.id, failure);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
      database.transaction(() => {
        if (
          !db.prepare('SELECT 1 FROM registration_cycle WHERE singleton=1 AND owner=?').get(owner)
        )
          return;
        const at = now();
        for (const item of pending.values()) {
          const attempt = Number(
            db.prepare('SELECT attempt FROM registration_attempts WHERE item_id=?').get(item.id)
              ?.attempt ?? 1,
          );
          db.prepare(
            'UPDATE registration_attempts SET failure_code=?,next_attempt_at=? WHERE item_id=?',
          ).run(
            failures.get(item.id) ?? 'registration_timeout',
            at + Math.min(3_600_000, retryMs * 2 ** Math.min(7, attempt - 1)),
            item.id,
          );
        }
        db.prepare(
          'UPDATE registration_cycle SET owner=NULL,expires_at=0,next_scan_at=? WHERE singleton=1 AND owner=?',
        ).run(pending.size ? at + retryMs : at, owner);
      });
    }
    return items.map((item) => ({
      itemId: item.id,
      status:
        db.prepare('SELECT stage FROM import_items WHERE id=?').get(item.id)?.stage === 'ready'
          ? 'ready'
          : 'registration_pending',
    }));
  };
  return {
    registerPending,
    runOnce: async (signal?: AbortSignal) => (await registerPending(signal)).length > 0,
  };
}
