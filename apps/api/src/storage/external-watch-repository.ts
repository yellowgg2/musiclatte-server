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
const observationSelect = `SELECT
  o.library_id,o.relative_file_key,o.account_directory,o.identity_key,o.state,
  CAST(o.device AS TEXT) AS device,CAST(o.inode AS TEXT) AS inode,
  CAST(o.size AS TEXT) AS size,CAST(o.mtime_ns AS TEXT) AS mtime_ns,
  CAST(o.ctime_ns AS TEXT) AS ctime_ns,o.link_count,
  o.first_seen_at,o.stable_since_at,o.last_seen_at,o.next_attempt_at,o.attempt,
  o.failure_code,o.event_id,o.media_link_id,o.lease_owner,o.lease_expires_at,o.generation
FROM external_file_observations o`;

export type ExternalObservationState =
  'baseline' | 'settling' | 'validating' | 'registering' | 'ready' | 'absent' | 'rejected';

export interface ExternalFileFingerprint {
  device: number | bigint | string;
  inode: number | bigint | string;
  size: number | bigint | string;
  mtimeNs: number | bigint | string;
  ctimeNs: number | bigint | string;
  linkCount: number;
}

export interface ExternalWatchContinuation {
  version: 1;
  directories: { key: string; offset: number }[];
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

function losslessInteger(value: unknown): string | null {
  const textValue = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^(0|[1-9]\d*)$/.test(textValue)) return null;
  try {
    return BigInt(textValue) <= 9_223_372_036_854_775_807n ? textValue : null;
  } catch {
    return null;
  }
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
    losslessInteger(value.device) !== null &&
    losslessInteger(value.inode) !== null &&
    losslessInteger(value.size) !== null &&
    losslessInteger(value.mtimeNs) !== null &&
    losslessInteger(value.ctimeNs) !== null &&
    Number.isSafeInteger(value.linkCount) &&
    value.linkCount >= 1
  );
}

function decodeContinuation(value: unknown): ExternalWatchContinuation | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1_048_576) throw new Error();
  const parsed = JSON.parse(value) as Partial<ExternalWatchContinuation>;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.directories) ||
    parsed.directories.length > 100_000 ||
    parsed.directories.some(
      (directory) =>
        !directory ||
        typeof directory !== 'object' ||
        typeof directory.key !== 'string' ||
        (directory.key !== '' && !validRelativeKey(directory.key)) ||
        !integer(directory.offset),
    )
  )
    throw new Error();
  return {
    version: 1,
    directories: parsed.directories.map((directory) => ({
      key: directory.key,
      offset: directory.offset,
    })),
  };
}

function decodeRoot(row: Record<string, unknown>) {
  try {
    if (
      !text(row.library_id) ||
      !validAccountDirectory(row.account_directory) ||
      typeof row.identity_key !== 'string' ||
      !identityPattern.test(row.identity_key) ||
      !['baselining', 'active', 'blocked'].includes(String(row.state)) ||
      !integer(row.generation) ||
      row.generation < 1 ||
      !optionalInteger(row.root_device) ||
      !optionalInteger(row.root_inode) ||
      !optionalInteger(row.scan_started_at) ||
      !optionalInteger(row.scan_completed_at) ||
      !integer(row.next_reconcile_at) ||
      (row.last_error_code !== null && !text(row.last_error_code)) ||
      !integer(row.updated_at)
    )
      throw new Error();
    return {
      libraryId: row.library_id,
      accountDirectory: row.account_directory,
      identityKey: row.identity_key,
      state: row.state as 'baselining' | 'active' | 'blocked',
      generation: row.generation,
      continuation: decodeContinuation(row.continuation_json),
      rootDevice: row.root_device,
      rootInode: row.root_inode,
      scanStartedAt: row.scan_started_at,
      scanCompletedAt: row.scan_completed_at,
      nextReconcileAt: row.next_reconcile_at,
      failureCode: row.last_error_code as string | null,
      updatedAt: row.updated_at,
    };
  } catch {
    throw new Error('Storage unavailable');
  }
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
  const fingerprintValues = [row.device, row.inode, row.size, row.link_count];
  const device = row.device === null ? null : losslessInteger(row.device);
  const inode = row.inode === null ? null : losslessInteger(row.inode);
  const size = row.size === null ? null : losslessInteger(row.size);
  const mtimeNs = row.mtime_ns === null ? null : losslessInteger(row.mtime_ns);
  const ctimeNs = row.ctime_ns === null ? null : losslessInteger(row.ctime_ns);
  if (
    !fingerprintValues.every((value) => value === null) &&
    (typeof row.link_count !== 'number' ||
      !Number.isSafeInteger(row.link_count) ||
      row.link_count < 1 ||
      device === null ||
      inode === null ||
      size === null ||
      mtimeNs === null ||
      ctimeNs === null)
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
            device: device!,
            inode: inode!,
            size: size!,
            mtimeNs: mtimeNs!,
            ctimeNs: ctimeNs!,
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
  for (const row of database.prepare('SELECT * FROM external_watch_roots').iterate())
    decodeRoot(row);
  for (const row of database.prepare(observationSelect).iterate()) decodeObservation(row);
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
      .prepare(`${observationSelect} WHERE library_id=? AND relative_file_key=?`)
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
        const desired = new Map(
          input.owners.map((owner) => [`${owner.libraryId}\0${owner.accountDirectory}`, owner]),
        );
        for (const row of db.prepare('SELECT * FROM external_watch_owners').iterate()) {
          const existing = decodeOwner(row);
          const owner = desired.get(`${existing.libraryId}\0${existing.accountDirectory}`);
          if (
            !owner ||
            owner.username !== existing.username ||
            owner.identityKey !== existing.identityKey
          )
            db.prepare(
              'DELETE FROM external_watch_owners WHERE library_id=? AND account_directory=?',
            ).run(existing.libraryId, existing.accountDirectory);
        }
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
    readOwners(input: {
      instanceId: string;
      policyRevision: number;
      expected: readonly {
        libraryId: string;
        accountDirectory: string;
        username: string;
      }[];
    }):
      | { status: 'ready'; owners: ReturnType<typeof decodeOwner>[] }
      | { status: 'mismatch'; owners: [] } {
      if (
        !text(input.instanceId) ||
        !Number.isSafeInteger(input.policyRevision) ||
        input.policyRevision < 1 ||
        input.expected.some(
          (owner) =>
            !text(owner.libraryId) ||
            !validAccountDirectory(owner.accountDirectory) ||
            !text(owner.username),
        )
      )
        return { status: 'mismatch', owners: [] };
      const owners = db
        .prepare(
          'SELECT * FROM external_watch_owners WHERE instance_id=? AND policy_revision=? ORDER BY library_id,account_directory',
        )
        .all(input.instanceId, input.policyRevision)
        .map(decodeOwner);
      const expected = input.expected
        .map((owner) => `${owner.libraryId}\0${owner.accountDirectory}\0${owner.username}`)
        .sort();
      const actual = owners
        .map((owner) => `${owner.libraryId}\0${owner.accountDirectory}\0${owner.username}`)
        .sort();
      return JSON.stringify(expected) === JSON.stringify(actual)
        ? { status: 'ready', owners }
        : { status: 'mismatch', owners: [] };
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
    getRoot(libraryId: string, accountDirectory: string) {
      const row = db
        .prepare('SELECT * FROM external_watch_roots WHERE library_id=? AND account_directory=?')
        .get(libraryId, accountDirectory);
      return row ? decodeRoot(row) : null;
    },
    startRootScan(input: {
      libraryId: string;
      accountDirectory: string;
      identityKey: string;
      rootDevice: number;
      rootInode: number;
      continuation: ExternalWatchContinuation;
    }) {
      if (
        !text(input.libraryId) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        !integer(input.rootDevice) ||
        !integer(input.rootInode)
      )
        throw new Error('Invalid external watch root');
      const continuation = decodeContinuation(JSON.stringify(input.continuation));
      if (!continuation) throw new Error('Invalid external watch root');
      const timestamp = now();
      db.prepare(
        `UPDATE external_watch_roots SET
          state=CASE WHEN scan_completed_at IS NULL THEN 'baselining' ELSE 'active' END,
          generation=generation+1,
          continuation_json=?,root_device=?,root_inode=?,
          scan_started_at=max(?,coalesce(scan_started_at,-1)+1,coalesce(scan_completed_at,-1)+1),
          last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
         WHERE library_id=? AND account_directory=? AND identity_key=?`,
      ).run(
        JSON.stringify(continuation),
        input.rootDevice,
        input.rootInode,
        timestamp,
        timestamp,
        input.libraryId,
        input.accountDirectory,
        input.identityKey,
      );
      return this.getRoot(input.libraryId, input.accountDirectory)!;
    },
    saveRootContinuation(input: {
      libraryId: string;
      accountDirectory: string;
      continuation: ExternalWatchContinuation;
    }) {
      const continuation = decodeContinuation(JSON.stringify(input.continuation));
      if (!continuation) throw new Error('Invalid external watch continuation');
      db.prepare(
        `UPDATE external_watch_roots SET continuation_json=?,last_error_code=NULL,updated_at=?
         WHERE library_id=? AND account_directory=?`,
      ).run(JSON.stringify(continuation), now(), input.libraryId, input.accountDirectory);
    },
    failRootScan(input: {
      libraryId: string;
      accountDirectory: string;
      failureCode: 'root_unavailable' | 'root_replaced' | 'entry_unreadable';
      nextReconcileAt: number;
    }) {
      if (!integer(input.nextReconcileAt)) throw new Error('Invalid external watch retry');
      db.prepare(
        `UPDATE external_watch_roots SET state='blocked',last_error_code=?,next_reconcile_at=?,updated_at=?
         WHERE library_id=? AND account_directory=?`,
      ).run(
        input.failureCode,
        input.nextReconcileAt,
        now(),
        input.libraryId,
        input.accountDirectory,
      );
    },
    completeRootScan(input: {
      libraryId: string;
      accountDirectory: string;
      nextReconcileAt: number;
    }) {
      if (!integer(input.nextReconcileAt)) throw new Error('Invalid external watch retry');
      const timestamp = now();
      database.transaction(() => {
        const root = db
          .prepare('SELECT * FROM external_watch_roots WHERE library_id=? AND account_directory=?')
          .get(input.libraryId, input.accountDirectory);
        const decoded = root ? decodeRoot(root) : null;
        if (!decoded || decoded.scanStartedAt === null)
          throw new Error('Invalid external watch root');
        const completedAt = Math.max(timestamp, decoded.scanStartedAt);
        db.prepare(
          `UPDATE external_file_observations SET
            state='absent',device=NULL,inode=NULL,size=NULL,mtime_ns=NULL,ctime_ns=NULL,link_count=NULL,
            stable_since_at=NULL,next_attempt_at=?,attempt=0,failure_code=NULL,
            lease_owner=NULL,lease_expires_at=NULL,generation=generation+1
           WHERE library_id=? AND account_directory=? AND state='settling' AND last_seen_at<?`,
        ).run(timestamp, input.libraryId, input.accountDirectory, decoded.scanStartedAt);
        db.prepare(
          `UPDATE external_watch_roots SET
            state='active',continuation_json=NULL,scan_completed_at=?,next_reconcile_at=?,
            last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
           WHERE library_id=? AND account_directory=?`,
        ).run(
          completedAt,
          input.nextReconcileAt,
          timestamp,
          input.libraryId,
          input.accountDirectory,
        );
      });
      return this.getRoot(input.libraryId, input.accountDirectory)!;
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
        fingerprint ? losslessInteger(fingerprint.device) : null,
        fingerprint ? losslessInteger(fingerprint.inode) : null,
        fingerprint ? losslessInteger(fingerprint.size) : null,
        fingerprint ? losslessInteger(fingerprint.mtimeNs) : null,
        fingerprint ? losslessInteger(fingerprint.ctimeNs) : null,
        fingerprint?.linkCount ?? null,
        timestamp,
        input.state === 'settling' ? timestamp : null,
        timestamp,
        input.nextAttemptAt,
      );
      return readObservation(input.libraryId, input.relativeFileKey)!;
    },
    getObservation: readObservation,
    listObservations(libraryId?: string) {
      const rows = libraryId
        ? db
            .prepare(`${observationSelect} WHERE library_id=? ORDER BY relative_file_key`)
            .all(libraryId)
        : db.prepare(`${observationSelect} ORDER BY library_id,relative_file_key`).all();
      return rows.map(decodeObservation);
    },
    discover(input: {
      libraryId: string;
      relativeFileKey: string;
      accountDirectory: string;
      identityKey: string;
      baseline: boolean;
      fingerprint: ExternalFileFingerprint;
      seenAt?: number;
    }) {
      if (
        !text(input.libraryId) ||
        !validRelativeKey(input.relativeFileKey) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        typeof input.baseline !== 'boolean' ||
        !validFingerprint(input.fingerprint) ||
        (input.seenAt !== undefined && !integer(input.seenAt))
      )
        throw new Error('Invalid external observation');
      const timestamp = now();
      const seenAt = Math.max(timestamp, input.seenAt ?? timestamp);
      const fingerprint = {
        device: losslessInteger(input.fingerprint.device)!,
        inode: losslessInteger(input.fingerprint.inode)!,
        size: losslessInteger(input.fingerprint.size)!,
        mtimeNs: losslessInteger(input.fingerprint.mtimeNs)!,
        ctimeNs: losslessInteger(input.fingerprint.ctimeNs)!,
        linkCount: input.fingerprint.linkCount,
      };
      const existing = readObservation(input.libraryId, input.relativeFileKey);
      if (!existing) {
        const state = input.baseline ? 'baseline' : 'settling';
        db.prepare(
          `INSERT INTO external_file_observations(
            library_id,relative_file_key,account_directory,identity_key,state,
            device,inode,size,mtime_ns,ctime_ns,link_count,
            first_seen_at,stable_since_at,last_seen_at,next_attempt_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          input.libraryId,
          input.relativeFileKey,
          input.accountDirectory,
          input.identityKey,
          state,
          fingerprint.device,
          fingerprint.inode,
          fingerprint.size,
          fingerprint.mtimeNs,
          fingerprint.ctimeNs,
          fingerprint.linkCount,
          timestamp,
          state === 'settling' ? timestamp : null,
          seenAt,
          timestamp,
        );
        return readObservation(input.libraryId, input.relativeFileKey)!;
      }
      if (
        existing.accountDirectory !== input.accountDirectory ||
        existing.identityKey !== input.identityKey
      )
        throw new Error('Storage unavailable');
      if (
        !['settling', 'absent'].includes(existing.state) ||
        (existing.state === 'absent' && existing.eventId !== null)
      ) {
        db.prepare(
          `UPDATE external_file_observations SET last_seen_at=?
           WHERE library_id=? AND relative_file_key=?`,
        ).run(seenAt, input.libraryId, input.relativeFileKey);
        return readObservation(input.libraryId, input.relativeFileKey)!;
      }
      const previous = existing.fingerprint;
      const changed =
        existing.state === 'absent' ||
        !previous ||
        previous.device !== fingerprint.device ||
        previous.inode !== fingerprint.inode ||
        previous.size !== fingerprint.size ||
        previous.mtimeNs !== fingerprint.mtimeNs ||
        previous.ctimeNs !== fingerprint.ctimeNs ||
        previous.linkCount !== fingerprint.linkCount;
      db.prepare(
        changed
          ? `UPDATE external_file_observations SET
              state='settling',device=?,inode=?,size=?,mtime_ns=?,ctime_ns=?,link_count=?,
              stable_since_at=?,last_seen_at=?,next_attempt_at=?,attempt=0,failure_code=NULL,
              event_id=NULL,media_link_id=NULL,lease_owner=NULL,lease_expires_at=NULL,
              generation=generation+1
             WHERE library_id=? AND relative_file_key=?`
          : `UPDATE external_file_observations SET last_seen_at=?
             WHERE library_id=? AND relative_file_key=?`,
      ).run(
        ...(changed
          ? [
              fingerprint.device,
              fingerprint.inode,
              fingerprint.size,
              fingerprint.mtimeNs,
              fingerprint.ctimeNs,
              fingerprint.linkCount,
              timestamp,
              seenAt,
              timestamp,
            ]
          : [seenAt]),
        input.libraryId,
        input.relativeFileKey,
      );
      return readObservation(input.libraryId, input.relativeFileKey)!;
    },
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
