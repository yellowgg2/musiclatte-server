import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  curationFields,
  decodeCurationTrack,
  decodeCompletionReceipt,
  decodeFieldState,
  type CompletionReceipt,
  type CurationField,
  type CurationTrack,
  type FieldState,
  type OptionalCurationField,
  type CurationStatus,
} from '@musiclatte/contracts';
import { createCurationPolicy, type CurationLimits } from '../curation/policy.js';
import {
  initialCuration,
  reduceCuration,
  effectiveCurationStatus,
  type CurationState,
  type CurationEvent,
} from '../curation/state.js';
import type { ManagementDatabase } from './database.js';

type Row = Record<string, SQLOutputValue>;
export interface CurationScope {
  instanceId: string;
  actorKey: string;
  credentialId: string;
  scopes: string[];
  libraryIds: string[];
  policyRevision: number;
}
export interface CurationFilter {
  curationStatus?: CurationStatus;
  missingField?: CurationField;
  field?: OptionalCurationField;
  fieldStatus?: FieldState['status'];
  format?: CurationTrack['format'];
  libraryId?: string;
}
export interface CurationObservation {
  revision: string;
  requiredFingerprint: string | null;
  audioIdentity: string;
  policyVersion: string;
  trusted: boolean;
  title: string | null;
  artist: string[];
  fields: Record<CurationField, boolean>;
  changedFields: readonly CurationField[];
}
export interface CurationCoverage {
  libraryId: string;
  status: 'discovering' | 'partial' | 'ready' | 'stale' | 'error';
  discoveredCount: number;
  verifiedCount: number;
  unknownCount: number;
  lastDiscoveryAt: number | null;
  lastReconciledAt: number | null;
  lastErrorCode: string | null;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function parse(value: SQLOutputValue | undefined): unknown {
  return JSON.parse(String(value));
}
function state(row: Row): CurationState {
  return {
    baseStatus: row.base_status as CurationState['baseStatus'],
    revision: row.revision as string | null,
    requiredFingerprint: row.required_fingerprint as string | null,
    audioIdentity: row.audio_identity as string | null,
    policyVersion: String(row.policy_version),
    receiptId: row.receipt_id as string | null,
    validation: row.validation as CurationState['validation'],
  };
}
function fieldState(row: Row): FieldState {
  return decodeFieldState({
    status: row.status,
    evidenceRevision: row.evidence_revision,
    lastAttemptAt: row.last_attempt_at,
    lastUpdatedAt: row.last_updated_at,
    reason: row.reason,
    sourceNotes: row.source_notes,
    actorRef: row.actor_ref,
  });
}
function receipt(row: Row, trackId: string): CompletionReceipt {
  return decodeCompletionReceipt({
    id: row.id,
    trackId,
    completedBy: parse(row.actor_json),
    completedAt: row.completed_at,
    verifiedRevision: row.verified_revision,
    policyVersion: row.policy_version,
    sourceNotes: row.source_notes,
  });
}
export function normalizeCurationFilter(filter: CurationFilter): CurationFilter {
  const allowed = ['curationStatus', 'missingField', 'field', 'fieldStatus', 'format', 'libraryId'];
  if (
    Object.keys(filter).some((key) => !allowed.includes(key)) ||
    (filter.missingField && (filter.field || filter.fieldStatus)) ||
    !!filter.field !== !!filter.fieldStatus ||
    (filter.curationStatus &&
      !['unreviewed', 'needs_review', 'in_progress', 'completed'].includes(
        filter.curationStatus,
      )) ||
    (filter.missingField && !curationFields.includes(filter.missingField)) ||
    (filter.field && !['album', 'cover', 'lyrics'].includes(filter.field)) ||
    (filter.fieldStatus &&
      !['unknown', 'missing', 'present', 'unavailable', 'not_applicable'].includes(
        filter.fieldStatus,
      )) ||
    (filter.format && !['mp3', 'unsupported'].includes(filter.format))
  )
    throw new Error('invalid_filter');
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as CurationFilter;
}
/** Internal database primitives: HTTP callers must supply fresh authority, revision and file fence. */
export function createCurationRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
  cursorKey: Uint8Array;
  limits: CurationLimits;
}) {
  const { database, clock, cursorKey, limits } = options;
  createCurationPolicy(limits);
  if (cursorKey.length < 32) throw new Error('Invalid curation cursor key');
  const db = database.connection;
  const atomic = <T>(fn: () => T): T => (db.isTransaction ? fn() : database.transaction(fn));
  const rowFor = (id: string) => db.prepare('SELECT * FROM curation_tracks WHERE id=?').get(id);
  const epoch = () =>
    String(
      db.prepare('SELECT claim_epoch FROM curation_state WHERE singleton=1').get()!.claim_epoch,
    );
  function activeClaim(id: string) {
    return db
      .prepare(
        'SELECT c.* FROM curation_claims c JOIN curation_claim_items i ON i.claim_id=c.id WHERE i.track_ref=? AND c.claim_epoch=? AND c.released_at IS NULL AND c.created_at<=? AND c.lease_until>? ORDER BY c.created_at LIMIT 1',
      )
      .get(id, epoch(), clock(), clock());
  }
  function get(id: string): CurationTrack | null {
    const row = rowFor(id);
    if (!row) return null;
    const fields = Object.fromEntries(
      db
        .prepare('SELECT * FROM curation_field_states WHERE track_ref=?')
        .all(id)
        .map((field) => [String(field.field), fieldState(field)]),
    ) as Record<CurationField, FieldState>;
    const claim = activeClaim(id);
    const receiptRow = row.receipt_id
      ? db.prepare('SELECT * FROM curation_receipts WHERE id=?').get(row.receipt_id)
      : null;
    return decodeCurationTrack({
      trackId: row.track_id,
      libraryId: row.library_id,
      format: row.format,
      title: row.title,
      artist: parse(row.artist_json),
      fileRevision: row.revision,
      curationStatus: effectiveCurationStatus(
        state(row),
        claim
          ? {
              purpose: claim.purpose as 'required_review' | 'optional_enrichment',
              leaseUntil: Number(claim.lease_until),
            }
          : null,
        clock(),
      ),
      fieldStates: fields,
      lyricsState: fields.lyrics.status,
      validation: row.validation,
      lastVerifiedAt: row.last_verified_at,
      receipt: receiptRow ? receipt(receiptRow, String(row.track_id)) : null,
    });
  }
  function saveState(id: string, next: CurationState) {
    db.prepare(
      'UPDATE curation_tracks SET base_status=?,revision=?,required_fingerprint=?,audio_identity=?,policy_version=?,receipt_id=?,validation=? WHERE id=?',
    ).run(
      next.baseStatus,
      next.revision,
      next.requiredFingerprint,
      next.audioIdentity,
      next.policyVersion,
      next.receiptId,
      next.validation,
      id,
    );
  }
  function event(id: string, kind: string, payload: unknown, key: string | null = null): boolean {
    return (
      db
        .prepare(
          'INSERT OR IGNORE INTO curation_events(track_ref,event_key,kind,payload_json,created_at) VALUES(?,?,?,?,?)',
        )
        .run(id, key, kind, JSON.stringify(payload), clock()).changes > 0
    );
  }
  function coverage(libraries: string[]): CurationCoverage[] {
    return [...new Set(libraries)].sort().map((libraryId) => {
      const run = db
        .prepare('SELECT * FROM curation_inventory_runs WHERE library_id=?')
        .get(libraryId);
      const count = db
        .prepare(
          "SELECT count(*) AS total,COALESCE(sum(validation='verified'),0) AS verified,COALESCE(sum(validation='unknown'),0) AS unknown_count FROM curation_tracks WHERE library_id=?",
        )
        .get(libraryId)!;
      return {
        libraryId,
        status: run ? (run.status as CurationCoverage['status']) : 'discovering',
        discoveredCount: Number(count.total),
        verifiedCount: Number(count.verified),
        unknownCount: Number(count.unknown_count),
        lastDiscoveryAt: (run?.last_discovery_at as number | null) ?? null,
        lastReconciledAt: (run?.last_reconciled_at as number | null) ?? null,
        lastErrorCode: (run?.last_error_code as string | null) ?? null,
      };
    });
  }
  function match(track: CurationTrack, filter: CurationFilter): boolean {
    const field = filter.missingField ?? filter.field;
    return (
      (!filter.libraryId || track.libraryId === filter.libraryId) &&
      (!filter.format || track.format === filter.format) &&
      (!filter.curationStatus || track.curationStatus === filter.curationStatus) &&
      (!field ||
        track.fieldStates[field].status === (filter.missingField ? 'missing' : filter.fieldStatus))
    );
  }
  function sign(payload: string) {
    return createHmac('sha256', cursorKey).update(payload).digest('base64url');
  }
  function cursor(id: string, ordinal: number, scopeHash: string, filterHash: string) {
    const payload = Buffer.from(JSON.stringify({ id, ordinal, scopeHash, filterHash })).toString(
      'base64url',
    );
    return `${payload}.${sign(payload)}`;
  }
  return {
    atomic,
    get,
    activeClaim,
    rowFor,
    event,
    coverage,
    discover(input: {
      libraryId: string;
      trackId: string;
      format: CurationTrack['format'];
      mediaLinkId?: string;
      fileIdentity?: string;
      bindingRevision?: number;
    }): string {
      return atomic(() => {
        const existing = db
          .prepare('SELECT id FROM curation_tracks WHERE library_id=? AND track_id=?')
          .get(input.libraryId, input.trackId);
        if (existing) return String(existing.id);
        const id = randomUUID();
        const initial = initialCuration();
        db.prepare(
          "INSERT INTO curation_tracks(id,library_id,track_id,media_link_id,file_identity,binding_revision,format,title,artist_json,base_status,revision,required_fingerprint,audio_identity,policy_version,receipt_id,validation,last_verified_at) VALUES(?,?,?,?,?,?,?,NULL,'[]',?,NULL,NULL,NULL,?,NULL,?,NULL)",
        ).run(
          id,
          input.libraryId,
          input.trackId,
          input.mediaLinkId ?? null,
          input.fileIdentity ?? null,
          input.bindingRevision ?? null,
          input.format,
          initial.baseStatus,
          initial.policyVersion,
          initial.validation,
        );
        for (const field of curationFields)
          db.prepare(
            "INSERT INTO curation_field_states(track_ref,field,status) VALUES(?,?,'unknown')",
          ).run(id, field);
        event(id, 'discovered', {});
        return id;
      });
    },
    transition(id: string, input: CurationEvent) {
      return atomic(() => {
        const row = rowFor(id);
        if (!row) throw new Error('not_found');
        saveState(id, reduceCuration(state(row), input));
        event(id, input.type, {});
        return get(id)!;
      });
    },
    observe(id: string, observation: CurationObservation, eventKey: string | null = null) {
      return atomic(() => {
        const row = rowFor(id);
        if (!row) throw new Error('not_found');
        if (
          eventKey &&
          db.prepare('SELECT sequence FROM curation_events WHERE event_key=?').get(eventKey)
        )
          return get(id)!;
        const next = reduceCuration(state(row), { type: 'observed', ...observation });
        saveState(id, next);
        db.prepare(
          'UPDATE curation_tracks SET title=?,artist_json=?,last_verified_at=? WHERE id=?',
        ).run(
          observation.title,
          JSON.stringify(observation.artist),
          observation.trusted ? clock() : row.last_verified_at!,
          id,
        );
        if (observation.trusted) {
          for (const field of curationFields) {
            const previous = fieldState(
              db
                .prepare('SELECT * FROM curation_field_states WHERE track_ref=? AND field=?')
                .get(id, field)!,
            );
            const keepAttempt =
              !observation.fields[field] &&
              !observation.changedFields.includes(field) &&
              ['unavailable', 'not_applicable'].includes(previous.status);
            db.prepare(
              'UPDATE curation_field_states SET status=?,evidence_revision=?,last_attempt_at=?,last_updated_at=?,reason=?,source_notes=?,actor_ref=? WHERE track_ref=? AND field=?',
            ).run(
              keepAttempt ? previous.status : observation.fields[field] ? 'present' : 'missing',
              observation.revision,
              keepAttempt ? previous.lastAttemptAt : null,
              clock(),
              keepAttempt ? previous.reason : null,
              keepAttempt ? previous.sourceNotes : null,
              keepAttempt ? previous.actorRef : null,
              id,
              field,
            );
          }
        }
        event(
          id,
          'observed',
          { revision: observation.revision, trusted: observation.trusted },
          eventKey,
        );
        return get(id)!;
      });
    },
    complete(
      id: string,
      actor: CompletionReceipt['completedBy'],
      sourceNotes: string | null,
    ): CompletionReceipt {
      return atomic(() => {
        const row = rowFor(id);
        if (!row || !row.file_identity) throw new Error('inventory_pending');
        const receiptId = randomUUID();
        const next = reduceCuration(state(row), { type: 'completed', receiptId });
        db.prepare('INSERT INTO curation_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          receiptId,
          id,
          row.file_identity,
          JSON.stringify(actor),
          clock(),
          next.revision!,
          next.requiredFingerprint!,
          next.audioIdentity!,
          next.policyVersion,
          sourceNotes,
        );
        saveState(id, next);
        event(id, 'completed', { receiptId });
        return get(id)!.receipt!;
      });
    },
    attempt(
      id: string,
      field: OptionalCurationField,
      status: 'unavailable' | 'not_applicable',
      reason: string,
      sourceNotes: string | null,
      actorRef: string,
    ) {
      return atomic(() => {
        if (
          !['album', 'cover', 'lyrics'].includes(field) ||
          !['unavailable', 'not_applicable'].includes(status) ||
          !reason.trim() ||
          reason.length > 4096 ||
          (sourceNotes?.length ?? 0) > 4096
        )
          throw new Error('invalid_attempt');
        const row = rowFor(id);
        const old = get(id)?.fieldStates[field];
        if (
          !row ||
          row.validation !== 'verified' ||
          !old ||
          !['missing', 'unavailable', 'not_applicable'].includes(old.status)
        )
          throw new Error('field_not_missing');
        db.prepare(
          'UPDATE curation_field_states SET status=?,evidence_revision=?,last_attempt_at=?,last_updated_at=?,reason=?,source_notes=?,actor_ref=? WHERE track_ref=? AND field=?',
        ).run(status, row.revision!, clock(), clock(), reason, sourceNotes, actorRef, id, field);
        event(id, 'attempt', { field, status, reason, sourceNotes, actorRef });
        return get(id)!.fieldStates[field];
      });
    },
    operation(
      actorKey: string,
      route: string,
      operationId: string,
      intent: unknown,
    ): unknown | null {
      const row = db
        .prepare(
          'SELECT * FROM curation_operations WHERE actor_key=? AND route=? AND operation_hash=?',
        )
        .get(actorKey, route, hash(operationId));
      if (!row) return null;
      if (row.intent_hash !== hash(intent)) throw new Error('operation_conflict');
      return parse(row.result_json);
    },
    recordOperation(
      actorKey: string,
      route: string,
      operationId: string,
      intent: unknown,
      result: unknown,
      admissionResults: unknown[] = [],
    ) {
      db.prepare('INSERT INTO curation_operations VALUES(?,?,?,?,?,?,?)').run(
        actorKey,
        route,
        hash(operationId),
        hash(intent),
        JSON.stringify(result),
        JSON.stringify(admissionResults),
        clock(),
      );
    },
    list(scope: CurationScope, input: CurationFilter, limit = 25, nextCursor?: string) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error('invalid_limit');
      const filter = normalizeCurationFilter(input);
      const filterHash = hash(filter);
      const scopeHash = hash([
        scope.instanceId,
        scope.actorKey,
        scope.credentialId,
        [...scope.scopes].sort(),
        [...scope.libraryIds].sort(),
        scope.policyRevision,
        epoch(),
      ]);
      return atomic(() => {
        let id: string;
        let ordinal = 0;
        if (nextCursor) {
          try {
            if (nextCursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(nextCursor))
              throw new Error();
            const [payload, mac] = nextCursor.split('.') as [string, string];
            if (!timingSafeEqual(Buffer.from(mac), Buffer.from(sign(payload)))) throw new Error();
            const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
              id: string;
              ordinal: number;
              scopeHash: string;
              filterHash: string;
            };
            if (
              typeof parsed.id !== 'string' ||
              !Number.isSafeInteger(parsed.ordinal) ||
              parsed.ordinal < 0
            )
              throw new Error();
            if (parsed.scopeHash !== scopeHash || parsed.filterHash !== filterHash)
              throw new Error('snapshot_scope_changed');
            id = parsed.id;
            ordinal = parsed.ordinal;
          } catch (error) {
            if (error instanceof Error && error.message === 'snapshot_scope_changed') throw error;
            throw new Error('invalid_cursor');
          }
        } else {
          db.prepare(
            'DELETE FROM curation_snapshots WHERE id IN (SELECT id FROM curation_snapshots WHERE expires_at<=? ORDER BY expires_at LIMIT 100)',
          ).run(clock());
          const used = Number(db.prepare('SELECT count(*) AS n FROM curation_snapshots').get()!.n);
          const stored = Number(
            db.prepare('SELECT count(*) AS n FROM curation_snapshot_items').get()!.n,
          );
          if (used >= limits.snapshotMaxCount || stored >= limits.snapshotMaxItems)
            throw new Error('snapshot_capacity');
          id = randomUUID();
          db.prepare('INSERT INTO curation_snapshots VALUES(?,?,?,?,?,0,?)').run(
            id,
            scopeHash,
            filterHash,
            clock(),
            clock() + limits.snapshotMaxAgeMs,
            JSON.stringify(coverage(scope.libraryIds)),
          );
          let total = 0;
          // Iterate bounded storage directly: no unbounded in-memory materialization of the library.
          for (const row of db
            .prepare(
              'SELECT id,library_id FROM curation_tracks ORDER BY library_id COLLATE BINARY,track_id COLLATE BINARY',
            )
            .iterate()) {
            if (!scope.libraryIds.includes(String(row.library_id))) continue;
            const track = get(String(row.id))!;
            if (!match(track, filter)) continue;
            if (stored + total >= limits.snapshotMaxItems) throw new Error('snapshot_capacity');
            db.prepare('INSERT INTO curation_snapshot_items VALUES(?,?,?)').run(
              id,
              total++,
              JSON.stringify(track),
            );
          }
          db.prepare('UPDATE curation_snapshots SET total=? WHERE id=?').run(total, id);
        }
        const snapshot = db.prepare('SELECT * FROM curation_snapshots WHERE id=?').get(id);
        if (!snapshot || Number(snapshot.expires_at) <= clock() || Number(snapshot.as_of) > clock())
          throw new Error('snapshot_expired');
        if (snapshot.scope_hash !== scopeHash || snapshot.filter_hash !== filterHash)
          throw new Error('snapshot_scope_changed');
        const tracks = db
          .prepare(
            'SELECT projection_json FROM curation_snapshot_items WHERE snapshot_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?',
          )
          .all(id, ordinal, limit)
          .map((row) => decodeCurationTrack(parse(row.projection_json)));
        const end = ordinal + tracks.length;
        return {
          snapshotId: id,
          asOf: Number(snapshot.as_of),
          expiresAt: Number(snapshot.expires_at),
          total: Number(snapshot.total),
          nextCursor: end < Number(snapshot.total) ? cursor(id, end, scopeHash, filterHash) : null,
          coverage: parse(snapshot.coverage_json) as CurationCoverage[],
          tracks,
        };
      });
    },
  };
}
export type CurationRepository = ReturnType<typeof createCurationRepository>;
export function validateCurationStorage(db: DatabaseSync): void {
  if (
    !/^[a-f0-9]{64}$/.test(
      String(
        db.prepare('SELECT claim_epoch FROM curation_state WHERE singleton=1').get()?.claim_epoch,
      ),
    )
  )
    throw new Error('Invalid curation storage');
  for (const row of db.prepare('SELECT * FROM curation_field_states').iterate()) fieldState(row);
  if (
    db
      .prepare(
        'SELECT t.id FROM curation_tracks t LEFT JOIN curation_field_states f ON f.track_ref=t.id GROUP BY t.id HAVING count(f.field)!=5',
      )
      .all().length
  )
    throw new Error('Invalid curation fields');
  if (
    db
      .prepare(
        'SELECT t.id FROM curation_tracks t JOIN curation_receipts r ON r.id=t.receipt_id WHERE r.track_ref!=t.id',
      )
      .all().length
  )
    throw new Error('Invalid curation receipt owner');
  for (const row of db
    .prepare(
      'SELECT r.*,t.track_id FROM curation_receipts r JOIN curation_tracks t ON t.id=r.track_ref',
    )
    .iterate())
    receipt(row, String(row.track_id));
  for (const row of db.prepare('SELECT * FROM curation_operations').iterate()) {
    if (
      !/^[a-f0-9]{64}$/.test(String(row.operation_hash)) ||
      !/^[a-f0-9]{64}$/.test(String(row.intent_hash)) ||
      !Array.isArray(parse(row.admission_results_json))
    )
      throw new Error('Invalid curation operation');
    parse(row.result_json);
  }
  for (const row of db.prepare('SELECT * FROM curation_claims').iterate()) {
    const fields = parse(row.fields_json);
    const allowed =
      row.purpose === 'required_review' ? ['title', 'artist'] : ['album', 'cover', 'lyrics'];
    if (
      !Array.isArray(fields) ||
      !fields.length ||
      new Set(fields).size !== fields.length ||
      !fields.every((field) => allowed.includes(field))
    )
      throw new Error('Invalid curation claim');
  }
  if (
    db
      .prepare(
        'SELECT s.id FROM curation_snapshots s LEFT JOIN curation_snapshot_items i ON i.snapshot_id=s.id GROUP BY s.id HAVING count(i.ordinal)!=s.total OR (s.total>0 AND (min(i.ordinal)!=0 OR max(i.ordinal)!=s.total-1))',
      )
      .all().length
  )
    throw new Error('Invalid curation snapshot');
  for (const row of db.prepare('SELECT projection_json FROM curation_snapshot_items').iterate())
    decodeCurationTrack(parse(row.projection_json));
}
