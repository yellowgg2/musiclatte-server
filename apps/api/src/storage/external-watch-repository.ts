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
const rootSelect = `SELECT
  library_id,account_directory,identity_key,state,generation,continuation_json,
  CAST(root_device AS TEXT) AS root_device,CAST(root_inode AS TEXT) AS root_inode,
  scan_started_at,scan_completed_at,next_reconcile_at,last_error_code,
  lease_owner,lease_expires_at,updated_at
FROM external_watch_roots`;

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
    const rootDevice = row.root_device === null ? null : losslessInteger(row.root_device);
    const rootInode = row.root_inode === null ? null : losslessInteger(row.root_inode);
    if (
      !text(row.library_id) ||
      !validAccountDirectory(row.account_directory) ||
      typeof row.identity_key !== 'string' ||
      !identityPattern.test(row.identity_key) ||
      !['baselining', 'active', 'blocked'].includes(String(row.state)) ||
      !integer(row.generation) ||
      row.generation < 1 ||
      (row.root_device !== null && rootDevice === null) ||
      (row.root_inode !== null && rootInode === null) ||
      (rootDevice === null) !== (rootInode === null) ||
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
      rootDevice,
      rootInode,
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
  for (const row of database.prepare(rootSelect).iterate()) decodeRoot(row);
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
        .prepare(`${rootSelect} WHERE library_id=? AND account_directory=?`)
        .get(libraryId, accountDirectory);
      return row ? decodeRoot(row) : null;
    },
    startRootScan(input: {
      libraryId: string;
      accountDirectory: string;
      identityKey: string;
      rootDevice: number | bigint | string;
      rootInode: number | bigint | string;
      continuation: ExternalWatchContinuation;
    }) {
      if (
        !text(input.libraryId) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        losslessInteger(input.rootDevice) === null ||
        losslessInteger(input.rootInode) === null
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
        losslessInteger(input.rootDevice),
        losslessInteger(input.rootInode),
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
      failureCode: 'root_unavailable' | 'root_replaced' | 'entry_unreadable' | 'inventory_capacity';
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
    commitScanSnapshot(input: {
      libraryId: string;
      accountDirectory: string;
      identityKey: string;
      rootGeneration: number;
      rootDevice: number | bigint | string;
      rootInode: number | bigint | string;
      baseline: boolean;
      entries: { relativeFileKey: string; fingerprint: ExternalFileFingerprint }[];
      nextReconcileAt: number;
    }) {
      const rootDevice = losslessInteger(input.rootDevice);
      const rootInode = losslessInteger(input.rootInode);
      if (
        !text(input.libraryId) ||
        !validAccountDirectory(input.accountDirectory) ||
        !identityPattern.test(input.identityKey) ||
        !Number.isSafeInteger(input.rootGeneration) ||
        input.rootGeneration < 1 ||
        rootDevice === null ||
        rootInode === null ||
        typeof input.baseline !== 'boolean' ||
        !integer(input.nextReconcileAt) ||
        input.entries.length > 100_000
      )
        throw new Error('Invalid external watch snapshot');
      const staged = new Map<
        string,
        {
          device: string;
          inode: string;
          size: string;
          mtimeNs: string;
          ctimeNs: string;
          linkCount: number;
        }
      >();
      for (const entry of input.entries) {
        if (!validRelativeKey(entry.relativeFileKey) || !validFingerprint(entry.fingerprint))
          throw new Error('Invalid external watch snapshot');
        const fingerprint = {
          device: losslessInteger(entry.fingerprint.device)!,
          inode: losslessInteger(entry.fingerprint.inode)!,
          size: losslessInteger(entry.fingerprint.size)!,
          mtimeNs: losslessInteger(entry.fingerprint.mtimeNs)!,
          ctimeNs: losslessInteger(entry.fingerprint.ctimeNs)!,
          linkCount: entry.fingerprint.linkCount,
        };
        if (staged.has(entry.relativeFileKey)) throw new Error('Invalid external watch snapshot');
        staged.set(entry.relativeFileKey, fingerprint);
      }
      const timestamp = now();
      database.transaction(() => {
        const rootRow = db
          .prepare(`${rootSelect} WHERE library_id=? AND account_directory=?`)
          .get(input.libraryId, input.accountDirectory);
        const root = rootRow ? decodeRoot(rootRow) : null;
        if (
          !root ||
          root.identityKey !== input.identityKey ||
          root.generation !== input.rootGeneration ||
          root.rootDevice !== rootDevice ||
          root.rootInode !== rootInode ||
          root.scanStartedAt === null
        )
          throw new Error('Invalid external watch root');
        const existing = new Map(
          db
            .prepare(
              `${observationSelect} WHERE library_id=? AND account_directory=? ORDER BY relative_file_key`,
            )
            .all(input.libraryId, input.accountDirectory)
            .map((row) => {
              const observation = decodeObservation(row);
              return [observation.relativeFileKey, observation] as const;
            }),
        );
        for (const [relativeFileKey, fingerprint] of staged) {
          const observation = existing.get(relativeFileKey);
          if (!observation) {
            const state = input.baseline ? 'baseline' : 'settling';
            db.prepare(
              `INSERT INTO external_file_observations(
                library_id,relative_file_key,account_directory,identity_key,state,
                device,inode,size,mtime_ns,ctime_ns,link_count,
                first_seen_at,stable_since_at,last_seen_at,next_attempt_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ).run(
              input.libraryId,
              relativeFileKey,
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
              timestamp,
              timestamp,
            );
            continue;
          }
          if (
            observation.accountDirectory !== input.accountDirectory ||
            observation.identityKey !== input.identityKey
          )
            throw new Error('Storage unavailable');
          if (
            !['settling', 'absent'].includes(observation.state) ||
            (observation.state === 'absent' && observation.eventId !== null)
          )
            continue;
          const previous = observation.fingerprint;
          const changed =
            observation.state === 'absent' ||
            !previous ||
            previous.device !== fingerprint.device ||
            previous.inode !== fingerprint.inode ||
            previous.size !== fingerprint.size ||
            previous.mtimeNs !== fingerprint.mtimeNs ||
            previous.ctimeNs !== fingerprint.ctimeNs ||
            previous.linkCount !== fingerprint.linkCount;
          if (!changed) continue;
          db.prepare(
            `UPDATE external_file_observations SET
              state='settling',device=?,inode=?,size=?,mtime_ns=?,ctime_ns=?,link_count=?,
              stable_since_at=?,last_seen_at=?,next_attempt_at=?,attempt=0,failure_code=NULL,
              event_id=NULL,media_link_id=NULL,lease_owner=NULL,lease_expires_at=NULL,
              generation=generation+1
             WHERE library_id=? AND relative_file_key=?`,
          ).run(
            fingerprint.device,
            fingerprint.inode,
            fingerprint.size,
            fingerprint.mtimeNs,
            fingerprint.ctimeNs,
            fingerprint.linkCount,
            timestamp,
            timestamp,
            timestamp,
            input.libraryId,
            relativeFileKey,
          );
        }
        for (const observation of existing.values()) {
          if (observation.state !== 'settling' || staged.has(observation.relativeFileKey)) continue;
          db.prepare(
            `UPDATE external_file_observations SET
              state='absent',device=NULL,inode=NULL,size=NULL,mtime_ns=NULL,ctime_ns=NULL,link_count=NULL,
              stable_since_at=NULL,next_attempt_at=?,attempt=0,failure_code=NULL,
              lease_owner=NULL,lease_expires_at=NULL,generation=generation+1
             WHERE library_id=? AND relative_file_key=? AND state='settling'`,
          ).run(timestamp, input.libraryId, observation.relativeFileKey);
        }
        const completedAt = Math.max(timestamp, root.scanStartedAt);
        const updated = db
          .prepare(
            `UPDATE external_watch_roots SET
              state='active',continuation_json=NULL,scan_completed_at=?,next_reconcile_at=?,
              last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
             WHERE library_id=? AND account_directory=? AND identity_key=? AND generation=?
               AND root_device=? AND root_inode=?`,
          )
          .run(
            completedAt,
            input.nextReconcileAt,
            timestamp,
            input.libraryId,
            input.accountDirectory,
            input.identityKey,
            input.rootGeneration,
            rootDevice,
            rootInode,
          );
        if (updated.changes !== 1) throw new Error('Invalid external watch root');
      });
      return this.getRoot(input.libraryId, input.accountDirectory)!;
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
          .prepare(`${rootSelect} WHERE library_id=? AND account_directory=?`)
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
    finishClaim(input: {
      libraryId: string;
      relativeFileKey: string;
      workerId: string;
      generation: number;
      state: 'settling' | 'rejected';
      failureCode: string | null;
      nextAttemptAt: number;
    }) {
      if (
        !text(input.workerId) ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 1 ||
        !integer(input.nextAttemptAt) ||
        (input.failureCode !== null && !text(input.failureCode))
      )
        throw new Error('Invalid external observation claim');
      const result = db
        .prepare(
          `UPDATE external_file_observations SET
            state=?,failure_code=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL
           WHERE library_id=? AND relative_file_key=? AND lease_owner=? AND generation=?`,
        )
        .run(
          input.state,
          input.failureCode,
          input.nextAttemptAt,
          input.libraryId,
          input.relativeFileKey,
          input.workerId,
          input.generation,
        );
      if (result.changes !== 1) throw new Error('External observation lease lost');
      return readObservation(input.libraryId, input.relativeFileKey)!;
    },
    admitExternal(input: {
      libraryId: string;
      relativeFileKey: string;
      accountDirectory: string;
      identityKey: string;
      instanceId: string;
      policyRevision: number;
      workerId: string;
      generation: number;
      fingerprint: ExternalFileFingerprint;
      eventId: string;
      mediaLinkId: string;
    }): { status: 'admitted' | 'internal'; eventId?: string; mediaLinkId?: string } {
      if (
        !text(input.eventId) ||
        !text(input.mediaLinkId) ||
        !validFingerprint(input.fingerprint) ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 1
      )
        throw new Error('Invalid external admission');
      return database.transaction(() => {
        const owner = db
          .prepare(
            `SELECT 1 FROM external_watch_owners
             WHERE library_id=? AND account_directory=? AND identity_key=?
               AND instance_id=? AND policy_revision=?`,
          )
          .get(
            input.libraryId,
            input.accountDirectory,
            input.identityKey,
            input.instanceId,
            input.policyRevision,
          );
        const observation = readObservation(input.libraryId, input.relativeFileKey);
        const expected = {
          device: losslessInteger(input.fingerprint.device),
          inode: losslessInteger(input.fingerprint.inode),
          size: losslessInteger(input.fingerprint.size),
          mtimeNs: losslessInteger(input.fingerprint.mtimeNs),
          ctimeNs: losslessInteger(input.fingerprint.ctimeNs),
          linkCount: input.fingerprint.linkCount,
        };
        if (
          !owner ||
          !observation ||
          observation.state !== 'settling' ||
          observation.accountDirectory !== input.accountDirectory ||
          observation.identityKey !== input.identityKey ||
          observation.leaseOwner !== input.workerId ||
          observation.generation !== input.generation ||
          JSON.stringify(observation.fingerprint) !== JSON.stringify(expected)
        )
          throw new Error('External observation lease lost');
        const internal = db
          .prepare(
            `SELECT 1 WHERE
              EXISTS(
                SELECT 1 FROM import_publish_intents p
                JOIN import_items i ON i.id=p.item_id JOIN import_jobs j ON j.id=i.job_id
                WHERE j.library_id=? AND p.relative_file_key=?
              ) OR
              EXISTS(
                SELECT 1 FROM download_events e JOIN media_links m ON m.id=e.media_link_id
                WHERE e.provenance='musiclatte' AND m.library_id=? AND m.relative_file_key=?
              ) OR
              EXISTS(
                SELECT 1 FROM metadata_items i JOIN media_links m ON m.id=i.media_link_id
                WHERE m.library_id=? AND m.relative_file_key=?
              ) OR
              EXISTS(
                SELECT 1 FROM organization_jobs j JOIN organization_items i ON i.job_id=j.id
                WHERE j.library_id=? AND (i.source_key=? OR i.target_key=?)
              ) OR
              EXISTS(
                SELECT 1 FROM organization_source_locations s JOIN media_links m ON m.id=s.media_link_id
                WHERE m.library_id=? AND (s.managed_key=? OR m.relative_file_key=?)
              )`,
          )
          .get(
            input.libraryId,
            input.relativeFileKey,
            input.libraryId,
            input.relativeFileKey,
            input.libraryId,
            input.relativeFileKey,
            input.libraryId,
            input.relativeFileKey,
            input.relativeFileKey,
            input.libraryId,
            input.relativeFileKey,
            input.relativeFileKey,
          );
        if (internal) {
          db.prepare(
            `UPDATE external_file_observations SET
              state='rejected',failure_code='internal_path',lease_owner=NULL,lease_expires_at=NULL
             WHERE library_id=? AND relative_file_key=?`,
          ).run(input.libraryId, input.relativeFileKey);
          return { status: 'internal' as const };
        }
        let media = db
          .prepare('SELECT id FROM media_links WHERE library_id=? AND relative_file_key=?')
          .get(input.libraryId, input.relativeFileKey) as { id?: unknown } | undefined;
        if (!media) {
          db.prepare(
            "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES(?,?,?,NULL,1,'unavailable',?,NULL)",
          ).run(input.mediaLinkId, input.libraryId, input.relativeFileKey, now());
          media = { id: input.mediaLinkId };
        }
        if (!text(media.id)) throw new Error('Storage unavailable');
        const completedAt = now();
        db.prepare(
          `INSERT INTO download_events(
            id,import_item_id,media_link_id,provenance,identity_key,library_id,
            download_completed_at,registered_at
          ) VALUES(?,NULL,?,'external',?,?,?,NULL)`,
        ).run(input.eventId, media.id, input.identityKey, input.libraryId, completedAt);
        db.prepare(
          `UPDATE external_file_observations SET
            state='registering',event_id=?,media_link_id=?,failure_code=NULL,
            attempt=0,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=?
           WHERE library_id=? AND relative_file_key=?`,
        ).run(input.eventId, media.id, completedAt, input.libraryId, input.relativeFileKey);
        return { status: 'admitted' as const, eventId: input.eventId, mediaLinkId: media.id };
      });
    },
    completeRegistration(input: {
      libraryId: string;
      relativeFileKey: string;
      workerId: string;
      generation: number;
      fingerprint: ExternalFileFingerprint;
      eventId: string;
      mediaLinkId: string;
      songId: string;
      verifyFile(): void;
    }) {
      if (
        !text(input.libraryId) ||
        !validRelativeKey(input.relativeFileKey) ||
        !text(input.workerId) ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 1 ||
        !validFingerprint(input.fingerprint) ||
        !text(input.eventId) ||
        !text(input.mediaLinkId) ||
        !text(input.songId)
      )
        throw new Error('Invalid external registration');
      return database.transaction(() => {
        const observation = readObservation(input.libraryId, input.relativeFileKey);
        const expected = {
          device: losslessInteger(input.fingerprint.device),
          inode: losslessInteger(input.fingerprint.inode),
          size: losslessInteger(input.fingerprint.size),
          mtimeNs: losslessInteger(input.fingerprint.mtimeNs),
          ctimeNs: losslessInteger(input.fingerprint.ctimeNs),
          linkCount: input.fingerprint.linkCount,
        };
        if (
          !observation ||
          observation.state !== 'registering' ||
          observation.leaseOwner !== input.workerId ||
          observation.generation !== input.generation ||
          observation.eventId !== input.eventId ||
          observation.mediaLinkId !== input.mediaLinkId ||
          JSON.stringify(observation.fingerprint) !== JSON.stringify(expected)
        )
          throw new Error('External registration conflict');
        const current = db
          .prepare(
            `SELECT 1 FROM download_events e
             JOIN media_links m ON m.id=e.media_link_id
             WHERE e.id=? AND e.provenance='external' AND e.registered_at IS NULL
               AND e.library_id=? AND e.media_link_id=?
               AND m.library_id=e.library_id AND m.relative_file_key=?
               AND (m.gonic_song_id IS NULL OR m.gonic_song_id=?)`,
          )
          .get(
            input.eventId,
            input.libraryId,
            input.mediaLinkId,
            input.relativeFileKey,
            input.songId,
          );
        if (!current) throw new Error('External registration conflict');
        input.verifyFile();
        const completedAt = now();
        const media = db
          .prepare(
            `UPDATE media_links SET
              gonic_song_id=?,availability='available',revision=revision+1,validated_at=?
             WHERE id=? AND library_id=? AND relative_file_key=?
               AND (gonic_song_id IS NULL OR gonic_song_id=?)`,
          )
          .run(
            input.songId,
            completedAt,
            input.mediaLinkId,
            input.libraryId,
            input.relativeFileKey,
            input.songId,
          );
        const event = db
          .prepare(
            `UPDATE download_events SET registered_at=?
             WHERE id=? AND provenance='external' AND registered_at IS NULL
               AND library_id=? AND media_link_id=?`,
          )
          .run(completedAt, input.eventId, input.libraryId, input.mediaLinkId);
        const observationUpdate = db
          .prepare(
            `UPDATE external_file_observations SET
              state='ready',failure_code=NULL,next_attempt_at=?,
              lease_owner=NULL,lease_expires_at=NULL
             WHERE library_id=? AND relative_file_key=? AND state='registering'
               AND lease_owner=? AND generation=? AND event_id=? AND media_link_id=?`,
          )
          .run(
            completedAt,
            input.libraryId,
            input.relativeFileKey,
            input.workerId,
            input.generation,
            input.eventId,
            input.mediaLinkId,
          );
        if (media.changes !== 1 || event.changes !== 1 || observationUpdate.changes !== 1)
          throw new Error('External registration conflict');
        return readObservation(input.libraryId, input.relativeFileKey)!;
      });
    },
    retryRegistration(input: {
      libraryId: string;
      relativeFileKey: string;
      workerId: string;
      generation: number;
      failureCode: string;
      nextAttemptAt: number;
    }) {
      if (
        !text(input.workerId) ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 1 ||
        !text(input.failureCode) ||
        !integer(input.nextAttemptAt)
      )
        throw new Error('Invalid external registration retry');
      const result = db
        .prepare(
          `UPDATE external_file_observations SET
            failure_code=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL
           WHERE library_id=? AND relative_file_key=? AND state='registering'
             AND lease_owner=? AND generation=?`,
        )
        .run(
          input.failureCode,
          input.nextAttemptAt,
          input.libraryId,
          input.relativeFileKey,
          input.workerId,
          input.generation,
        );
      if (result.changes !== 1) throw new Error('External observation lease lost');
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
