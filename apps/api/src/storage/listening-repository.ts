import type { DatabaseSync } from 'node:sqlite';
import { listeningDeliveryStatuses, type ListeningDeliveryStatus } from '@musiclatte/contracts';
import type { ManagementDatabase } from './database.js';
export interface ListeningInsert {
  identityKey: string;
  eventIdHash: string;
  requestHash: string;
  songId: string;
  startedAt: number;
  qualifiedAt: number;
}
export interface StoredListeningEvent extends ListeningInsert {
  sequence: number;
  receivedAt: number;
  source: 'web';
  status: ListeningDeliveryStatus;
}
export interface ListeningTopAnchor {
  count: number;
  lastQualifiedAt: number;
  songId: string;
}
export interface ListeningWindow {
  limit?: number;
  highWater?: number;
  from?: number;
  to?: number;
}
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const key = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validate(input: ListeningInsert) {
  if (
    !key(input.identityKey) ||
    !key(input.eventIdHash) ||
    !key(input.requestHash) ||
    typeof input.songId !== 'string' ||
    !input.songId.trim() ||
    input.songId.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.songId) ||
    !time(input.startedAt) ||
    !time(input.qualifiedAt) ||
    input.qualifiedAt < input.startedAt
  )
    throw new Error('Invalid listening event');
}
function decode(row: Record<string, unknown>): StoredListeningEvent {
  const event = {
    identityKey: row.identity_key,
    eventIdHash: row.event_id_hash,
    requestHash: row.request_hash,
    songId: row.song_id,
    startedAt: row.started_at,
    qualifiedAt: row.qualified_at,
  } as ListeningInsert;
  validate(event);
  if (
    !time(row.sequence) ||
    row.sequence === 0 ||
    !time(row.received_at) ||
    row.source !== 'web' ||
    !listeningDeliveryStatuses.includes(row.status as ListeningDeliveryStatus)
  )
    throw new Error('Invalid listening event');
  return {
    ...event,
    sequence: row.sequence,
    receivedAt: row.received_at,
    source: 'web',
    status: row.status as ListeningDeliveryStatus,
  };
}
const joined =
  'SELECT e.*,d.status,d.claimed_at,d.finished_at FROM listening_events e LEFT JOIN listening_deliveries d ON d.event_sequence=e.sequence';
export function validateListeningStorage(db: DatabaseSync) {
  for (const row of db.prepare(joined).iterate()) {
    const event = decode(row);
    const claimed = row.claimed_at;
    const finished = row.finished_at;
    const valid =
      event.status === 'not_sent'
        ? claimed === null && finished === null
        : event.status === 'dispatching'
          ? time(claimed) && finished === null
          : event.status === 'skipped'
            ? claimed === null && time(finished)
            : time(claimed) && time(finished) && finished >= claimed;
    if (!valid) throw new Error('Invalid listening receipt');
  }
  if (
    db
      .prepare(
        'SELECT 1 FROM listening_deliveries d LEFT JOIN listening_events e ON e.sequence=d.event_sequence WHERE e.sequence IS NULL LIMIT 1',
      )
      .get()
  )
    throw new Error('Invalid listening receipt');
}
export function createListeningRepository({
  database,
  clock,
}: {
  database: ManagementDatabase;
  clock(): number;
}) {
  const db = database.connection;
  function now() {
    const value = clock();
    if (!time(value)) throw new Error('Invalid listening time');
    return value;
  }
  function receipt(identityKey: string, eventIdHash: string): StoredListeningEvent | null {
    if (!key(identityKey) || !key(eventIdHash)) throw new Error('Invalid listening identity');
    const row = db
      .prepare(`${joined} WHERE e.identity_key=? AND e.event_id_hash=?`)
      .get(identityKey, eventIdHash);
    return row ? decode(row) : null;
  }
  function window(identityKey: string, options: ListeningWindow) {
    const limit = options.limit ?? 50;
    const from = options.from ?? 0;
    const to = options.to ?? Number.MAX_SAFE_INTEGER;
    if (
      !key(identityKey) ||
      !time(limit) ||
      limit < 1 ||
      limit > 100 ||
      !time(from) ||
      !time(to) ||
      from >= to ||
      (options.highWater !== undefined && !time(options.highWater))
    )
      throw new Error('Invalid listening query');
    const highWater =
      options.highWater ??
      Number(
        db
          .prepare(
            'SELECT coalesce(max(sequence),0) AS n FROM listening_events WHERE identity_key=?',
          )
          .get(identityKey)?.n,
      );
    return { limit, from, to, highWater };
  }
  return {
    receipt,
    insert(input: ListeningInsert, skip = false): StoredListeningEvent {
      validate(input);
      return database.transaction(() => {
        const old = receipt(input.identityKey, input.eventIdHash);
        if (old) {
          if (
            old.requestHash !== input.requestHash ||
            old.songId !== input.songId ||
            old.startedAt !== input.startedAt ||
            old.qualifiedAt !== input.qualifiedAt
          )
            throw new Error('Listening conflict');
          return old;
        }
        const receivedAt = now();
        const result = db
          .prepare(
            'INSERT INTO listening_events(identity_key,event_id_hash,request_hash,song_id,started_at,qualified_at,received_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            input.identityKey,
            input.eventIdHash,
            input.requestHash,
            input.songId,
            input.startedAt,
            input.qualifiedAt,
            receivedAt,
          );
        db.prepare(
          'INSERT INTO listening_deliveries(event_sequence,status,finished_at) VALUES(?,?,?)',
        ).run(result.lastInsertRowid, skip ? 'skipped' : 'not_sent', skip ? receivedAt : null);
        return receipt(input.identityKey, input.eventIdHash)!;
      });
    },
    claim(sequence: number) {
      if (!time(sequence) || !sequence) throw new Error('Invalid listening sequence');
      return (
        db
          .prepare(
            "UPDATE listening_deliveries SET status='dispatching',claimed_at=? WHERE event_sequence=? AND status='not_sent'",
          )
          .run(now(), sequence).changes === 1
      );
    },
    finish(sequence: number, status: 'submitted' | 'uncertain') {
      if (!time(sequence) || !['submitted', 'uncertain'].includes(status))
        throw new Error('Invalid listening receipt');
      return (
        db
          .prepare(
            "UPDATE listening_deliveries SET status=?,finished_at=max(claimed_at,?) WHERE event_sequence=? AND status='dispatching'",
          )
          .run(status, now(), sequence).changes === 1
      );
    },
    /** Only the exclusive runtime startup owner may recover after its predecessor has exited. */
    recoverDispatching() {
      return Number(
        db
          .prepare(
            "UPDATE listening_deliveries SET status='uncertain',finished_at=max(claimed_at,?) WHERE status='dispatching'",
          )
          .run(now()).changes,
      );
    },
    history(identityKey: string, options: ListeningWindow & { anchor?: number } = {}) {
      return database.transaction(() => {
        const { limit, from, to, highWater } = window(identityKey, options);
        if (options.anchor !== undefined && (!time(options.anchor) || options.anchor > highWater))
          throw new Error('Invalid listening cursor');
        const rows = db
          .prepare(
            `${joined} WHERE e.identity_key=? AND e.sequence<=? AND e.sequence<? AND e.qualified_at>=? AND e.qualified_at<? ORDER BY e.sequence DESC LIMIT ?`,
          )
          .all(
            identityKey,
            highWater,
            options.anchor ?? Number.MAX_SAFE_INTEGER,
            from,
            to,
            limit + 1,
          );
        const items = rows.slice(0, limit).map(decode);
        return { items, highWater, next: rows.length > limit ? items.at(-1)!.sequence : null };
      });
    },
    top(identityKey: string, options: ListeningWindow & { anchor?: ListeningTopAnchor } = {}) {
      return database.transaction(() => {
        const { limit, from, to, highWater } = window(identityKey, options);
        const a = options.anchor;
        if (
          a &&
          (!time(a.count) ||
            !a.count ||
            !time(a.lastQualifiedAt) ||
            typeof a.songId !== 'string' ||
            !a.songId)
        )
          throw new Error('Invalid listening cursor');
        const rows = db
          .prepare(
            `SELECT song_id AS songId,count(*) AS count,max(qualified_at) AS lastQualifiedAt FROM listening_events WHERE identity_key=? AND sequence<=? AND qualified_at>=? AND qualified_at<? GROUP BY song_id ${a ? 'HAVING count(*)<? OR (count(*)=? AND max(qualified_at)<?) OR (count(*)=? AND max(qualified_at)=? AND song_id>?)' : ''} ORDER BY count DESC,lastQualifiedAt DESC,songId ASC LIMIT ?`,
          )
          .all(
            identityKey,
            highWater,
            from,
            to,
            ...(a
              ? [a.count, a.count, a.lastQualifiedAt, a.count, a.lastQualifiedAt, a.songId]
              : []),
            limit + 1,
          );
        const items = rows.slice(0, limit).map((row) => ({
          songId: String(row.songId),
          count: Number(row.count),
          lastQualifiedAt: Number(row.lastQualifiedAt),
        }));
        return { items, highWater, next: rows.length > limit ? items.at(-1)! : null };
      });
    },
  };
}
