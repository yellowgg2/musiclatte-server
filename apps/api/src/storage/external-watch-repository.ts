import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

const identityPattern = /^[a-f0-9]{64}$/;
const states = new Set([
  'baseline',
  'settling',
  'validating',
  'registering',
  'ready',
  'absent',
  'rejected',
] as const);

export type ExternalObservationState =
  'baseline' | 'settling' | 'validating' | 'registering' | 'ready' | 'absent' | 'rejected';

export interface ExternalFileFingerprint {
  device: number;
  inode: number;
  size: number;
  mtimeNs: number;
  ctimeNs: number;
  linkCount: number;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalInteger(value: unknown): value is number | null {
  return value === null || integer(value);
}

function validAccountDirectory(value: unknown): value is string {
  return (
    text(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
  );
}

function validRelativeKey(value: unknown): value is string {
  if (!text(value) || value.startsWith('/') || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function validFingerprint(value: ExternalFileFingerprint): boolean {
  return (
    integer(value.device) &&
    integer(value.inode) &&
    integer(value.size) &&
    integer(value.mtimeNs) &&
    integer(value.ctimeNs) &&
    Number.isSafeInteger(value.linkCount) &&
    value.linkCount >= 1
  );
}

function decodeOwner(row: Record<string, unknown>) {
  if (
    !text(row.library_id) ||
    !validAccountDirectory(row.account_directory) ||
    !text(row.username) ||
    typeof row.identity_key !== 'string' ||
    !identityPattern.test(row.identity_key) ||
    !text(row.instance_id) ||
    !integer(row.policy_revision) ||
    row.policy_revision < 1 ||
    !integer(row.updated_at)
  )
    throw new Error('Storage unavailable');
  return {
    libraryId: row.library_id,
    accountDirectory: row.account_directory,
    username: row.username,
    identityKey: row.identity_key,
    instanceId: row.instance_id,
    policyRevision: row.policy_revision,
    updatedAt: row.updated_at,
  };
}

function decodeObservation(row: Record<string, unknown>) {
  if (
    !text(row.library_id) ||
    !validRelativeKey(row.relative_file_key) ||
    !validAccountDirectory(row.account_directory) ||
    typeof row.identity_key !== 'string' ||
    !identityPattern.test(row.identity_key) ||
    typeof row.state !== 'string' ||
    !states.has(row.state as ExternalObservationState) ||
    !integer(row.first_seen_at) ||
    !integer(row.last_seen_at) ||
    !integer(row.next_attempt_at) ||
    !integer(row.attempt) ||
    !optionalInteger(row.stable_since_at) ||
    !optionalInteger(row.lease_expires_at) ||
    !integer(row.generation) ||
    row.generation < 1
  )
    throw new Error('Storage unavailable');
  const fingerprintValues = [
    row.device,
    row.inode,
    row.size,
    row.mtime_ns,
    row.ctime_ns,
    row.link_count,
  ];
  if (
    !fingerprintValues.every((value) => value === null) &&
    !fingerprintValues.every((value, index) =>
      index === 5
        ? typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
        : integer(value),
    )
  )
    throw new Error('Storage unavailable');
  if (
    (row.lease_owner === null) !== (row.lease_expires_at === null) ||
    (row.lease_owner !== null && !text(row.lease_owner)) ||
    (row.failure_code !== null && !text(row.failure_code)) ||
    (row.event_id !== null && !text(row.event_id)) ||
    (row.media_link_id !== null && !text(row.media_link_id))
  )
    throw new Error('Storage unavailable');
  return {
    libraryId: row.library_id as string,
    relativeFileKey: row.relative_file_key as string,
    accountDirectory: row.account_directory as string,
    identityKey: row.identity_key as string,
    state: row.state as ExternalObservationState,
    fingerprint:
      row.device === null
        ? null
        : {
            device: row.device as number,
            inode: row.inode as number,
            size: row.size as number,
            mtimeNs: row.mtime_ns as number,
            ctimeNs: row.ctime_ns as number,
            linkCount: row.link_count as number,
          },
    firstSeenAt: row.first_seen_at as number,
    stableSinceAt: row.stable_since_at as number | null,
    lastSeenAt: row.last_seen_at as number,
    nextAttemptAt: row.next_attempt_at as number,
    attempt: row.attempt as number,
    failureCode: row.failure_code as string | null,
    eventId: row.event_id as string | null,
    mediaLinkId: row.media_link_id as string | null,
    leaseOwner: row.lease_owner as string | null,
    leaseExpiresAt: row.lease_expires_at as number | null,
    generation: row.generation as number,
  };
}

export function validateExternalWatchStorage(database: DatabaseSync): void {
  for (const row of database.prepare('SELECT * FROM external_watch_owners').iterate())
    decodeOwner(row);
  for (const row of database.prepare('SELECT * FROM external_file_observations').iterate())
    decodeObservation(row);
  if (
    database
      .prepare(
        "SELECT 1 FROM external_file_observations o JOIN download_events e ON e.id=o.event_id WHERE o.event_id IS NOT NULL AND (e.provenance<>'external' OR e.media_link_id<>o.media_link_id OR e.identity_key<>o.identity_key OR e.library_id<>o.library_id) LIMIT 1",
      )
      .get()
  )
    throw new Error('Storage unavailable');
}

export function createExternalWatchRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const now = () => {
    const value = clock();
    if (!integer(value)) throw new Error('Invalid external watch time');
    return value;
  };
  const readObservation = (libraryId: string, relativeFileKey: string) => {
    const row = db
      .prepare(
        'SELECT * FROM external_file_observations WHERE library_id=? AND relative_file_key=?',
      )
      .get(libraryId, relativeFileKey);
    return row ? decodeObservation(row) : null;
  };
  return {
    syncOwners(input: {
      instanceId: string;
      policyRevision: number;
      owners: readonly {
        libraryId: string;
        accountDirectory: string;
        username: string;
        identityKey: string;
      }[];
    }) {
      if (
        !text(input.instanceId) ||
        !Number.isSafeInteger(input.policyRevision) ||
        input.policyRevision < 1
      )
        throw new Error('Invalid external watch owner');
      const directories = new Set<string>();
      const usernames = new Set<string>();
      const identities = new Set<string>();
      for (const owner of input.owners) {
        const directoryKey = `${owner.libraryId}\0${owner.accountDirectory}`;
        const usernameKey = `${owner.libraryId}\0${owner.username}`;
        const identityKey = `${owner.libraryId}\0${owner.identityKey}`;
        if (
          !text(owner.libraryId) ||
          !validAccountDirectory(owner.accountDirectory) ||
          !text(owner.username) ||
          !identityPattern.test(owner.identityKey) ||
          directories.has(directoryKey) ||
          usernames.has(usernameKey) ||
          identities.has(identityKey)
        )
          throw new Error('Invalid external watch owner');
        directories.add(directoryKey);
        usernames.add(usernameKey);
        identities.add(identityKey);
      }
      const updatedAt = now();
      database.transaction(() => {
        for (const owner of input.owners)
          db.prepare(
            `INSERT INTO external_watch_owners(
              library_id,account_directory,username,identity_key,instance_id,policy_revision,updated_at
            ) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(library_id,account_directory) DO UPDATE SET
              username=excluded.username,
              identity_key=excluded.identity_key,
              instance_id=excluded.instance_id,
              policy_revision=excluded.policy_revision,
              updated_at=excluded.updated_at`,
          ).run(
            owner.libraryId,
            owner.accountDirectory,
            owner.username,
            owner.identityKey,
            input.instanceId,
            input.policyRevision,
            updatedAt,
          );
        db.prepare(
          `DELETE FROM external_watch_owners
           WHERE (instance_id<>? OR policy_revision<>?)
             AND NOT EXISTS (
               SELECT 1 FROM external_file_observations o
               WHERE o.library_id=external_watch_owners.library_id
                 AND o.account_directory=external_watch_owners.account_directory
             )`,
        ).run(input.instanceId, input.policyRevision);
      });
    },
    listOwners(filter?: { instanceId: string; policyRevision: number }) {
      const rows = filter
        ? db
            .prepare(
              'SELECT * FROM external_watch_owners WHERE instance_id=? AND policy_revision=? ORDER BY library_id,account_directory',
            )
            .all(filter.instanceId, filter.policyRevision)
        : db
            .prepare('SELECT * FROM external_watch_owners ORDER BY library_id,account_directory')
            .all();
      return rows.map(decodeOwner);
    },
    ensureRoot(input: {
      libraryId: string;
      accountDirectory: string;
      identityKey: string;
      nextReconcileAt?: number;
    }) {
      if (
        !text(input.libraryId) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        (input.nextReconcileAt !== undefined && !integer(input.nextReconcileAt))
      )
        throw new Error('Invalid external watch root');
      const timestamp = now();
      db.prepare(
        `INSERT INTO external_watch_roots(
          library_id,account_directory,identity_key,state,next_reconcile_at,updated_at
        ) VALUES(?,?,?,'baselining',?,?)
        ON CONFLICT(library_id,account_directory) DO UPDATE SET
          identity_key=excluded.identity_key,
          next_reconcile_at=min(external_watch_roots.next_reconcile_at,excluded.next_reconcile_at),
          updated_at=excluded.updated_at`,
      ).run(
        input.libraryId,
        input.accountDirectory,
        input.identityKey,
        input.nextReconcileAt ?? timestamp,
        timestamp,
      );
    },
    observe(input: {
      libraryId: string;
      relativeFileKey: string;
      accountDirectory: string;
      identityKey: string;
      state: ExternalObservationState;
      fingerprint: ExternalFileFingerprint | null;
      nextAttemptAt: number;
    }) {
      if (
        !text(input.libraryId) ||
        !validRelativeKey(input.relativeFileKey) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        !states.has(input.state) ||
        !integer(input.nextAttemptAt) ||
        (input.fingerprint !== null && !validFingerprint(input.fingerprint))
      )
        throw new Error('Invalid external observation');
      const timestamp = now();
      const fingerprint = input.fingerprint;
      db.prepare(
        `INSERT INTO external_file_observations(
          library_id,relative_file_key,account_directory,identity_key,state,
          device,inode,size,mtime_ns,ctime_ns,link_count,
          first_seen_at,stable_since_at,last_seen_at,next_attempt_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(library_id,relative_file_key) DO UPDATE SET
          last_seen_at=excluded.last_seen_at,
          next_attempt_at=min(external_file_observations.next_attempt_at,excluded.next_attempt_at)`,
      ).run(
        input.libraryId,
        input.relativeFileKey,
        input.accountDirectory,
        input.identityKey,
        input.state,
        fingerprint?.device ?? null,
        fingerprint?.inode ?? null,
        fingerprint?.size ?? null,
        fingerprint?.mtimeNs ?? null,
        fingerprint?.ctimeNs ?? null,
        fingerprint?.linkCount ?? null,
        timestamp,
        input.state === 'settling' ? timestamp : null,
        timestamp,
        input.nextAttemptAt,
      );
      return readObservation(input.libraryId, input.relativeFileKey)!;
    },
    getObservation: readObservation,
    claimObservations(input: {
      workerId: string;
      leaseDurationMs: number;
      states: readonly ExternalObservationState[];
      limit: number;
    }) {
      if (
        !text(input.workerId) ||
        !Number.isSafeInteger(input.leaseDurationMs) ||
        input.leaseDurationMs <= 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit <= 0 ||
        input.states.length === 0 ||
        input.states.some((state) => !states.has(state))
      )
        throw new Error('Invalid external observation claim');
      const timestamp = now();
      const placeholders = input.states.map(() => '?').join(',');
      return database.transaction(() => {
        const rows = db
          .prepare(
            `SELECT library_id,relative_file_key
             FROM external_file_observations INDEXED BY external_file_observations_runnable
             WHERE state IN (${placeholders})
               AND next_attempt_at<=?
               AND (lease_expires_at IS NULL OR lease_expires_at<=?)
             ORDER BY next_attempt_at,library_id,relative_file_key
             LIMIT ?`,
          )
          .all(...input.states, timestamp, timestamp, input.limit);
        const claimed = [];
        for (const row of rows) {
          const result = db
            .prepare(
              `UPDATE external_file_observations
               SET lease_owner=?,lease_expires_at=?,attempt=attempt+1,generation=generation+1
               WHERE library_id=? AND relative_file_key=?
                 AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
            )
            .run(
              input.workerId,
              timestamp + input.leaseDurationMs,
              String(row.library_id),
              String(row.relative_file_key),
              timestamp,
            );
          if (result.changes === 1)
            claimed.push(readObservation(String(row.library_id), String(row.relative_file_key))!);
        }
        return claimed;
      });
    },
  };
}
