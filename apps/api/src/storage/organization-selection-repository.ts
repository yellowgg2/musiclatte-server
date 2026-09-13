import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  UnorganizedSelectionItem,
  UnorganizedSelectionPage,
  UnorganizedSelectionSummary,
} from '@musiclatte/contracts';
import { decodeUnorganizedSelectionPage } from '@musiclatte/contracts';
import type { ManagementDatabase } from './database.js';

export interface OrganizationSelectionSnapshotLimits {
  snapshotMaxAgeMs: number;
  snapshotMaxItems: number;
  snapshotMaxCount: number;
}

interface SnapshotScope {
  actorTokenId: string;
  scopeHash: string;
}

function validateLimits(limits: OrganizationSelectionSnapshotLimits) {
  for (const [key, value] of Object.entries(limits)) {
    const maximum = key.endsWith('Ms') ? 86_400_000 : 1_000_000;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error('invalid_selection_limits');
  }
}

export function createOrganizationSelectionRepository(options: {
  database: ManagementDatabase;
  clock(): number;
  cursorKey: Uint8Array;
  limits: OrganizationSelectionSnapshotLimits;
}) {
  validateLimits(options.limits);
  if (options.cursorKey.length < 32) throw new Error('invalid_selection_cursor_key');
  const db = options.database.connection;
  const atomic = <T>(work: () => T) =>
    db.isTransaction ? work() : options.database.transaction(work);
  const sign = (payload: string) =>
    createHmac('sha256', options.cursorKey).update(payload).digest('base64url');
  const makeCursor = (
    selectionId: string,
    ordinal: number,
    scopeHash: string,
    inventoryRevision: string,
  ) => {
    const payload = Buffer.from(
      JSON.stringify({ selectionId, ordinal, scopeHash, inventoryRevision }),
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const decodeCursor = (value: string) => {
    try {
      if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value))
        throw new Error();
      const [payload, mac] = value.split('.') as [string, string];
      const expected = Buffer.from(sign(payload));
      const actual = Buffer.from(mac);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw new Error();
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        Object.keys(parsed).length !== 4 ||
        typeof parsed.selectionId !== 'string' ||
        !parsed.selectionId ||
        !Number.isSafeInteger(parsed.ordinal) ||
        Number(parsed.ordinal) < 0 ||
        typeof parsed.scopeHash !== 'string' ||
        typeof parsed.inventoryRevision !== 'string'
      )
        throw new Error();
      return {
        selectionId: parsed.selectionId,
        ordinal: Number(parsed.ordinal),
        scopeHash: parsed.scopeHash,
        inventoryRevision: parsed.inventoryRevision,
      };
    } catch {
      throw new Error('invalid_cursor');
    }
  };
  const readPage = (
    scope: SnapshotScope,
    selectionId: string,
    ordinal: number,
    limit: number,
  ): UnorganizedSelectionPage => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_limit');
    const snapshot = db
      .prepare('SELECT * FROM organization_selection_snapshots WHERE id=?')
      .get(selectionId);
    if (
      !snapshot ||
      Number(snapshot.expires_at) <= options.clock() ||
      Number(snapshot.captured_at) > options.clock()
    )
      throw new Error('snapshot_expired');
    if (snapshot.scope_hash !== scope.scopeHash || snapshot.actor_token_id !== scope.actorTokenId)
      throw new Error('snapshot_scope_changed');
    const summary = JSON.parse(String(snapshot.summary_json)) as UnorganizedSelectionSummary;
    if (ordinal > summary.needsOrganization) throw new Error('invalid_cursor');
    const rows = db
      .prepare(
        'SELECT ordinal,media_link_id,track_id,title,artist,album FROM organization_selection_snapshot_items WHERE selection_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?',
      )
      .all(selectionId, ordinal, limit);
    if (
      rows.some((row, index) => Number(row.ordinal) !== ordinal + index) ||
      (ordinal < summary.needsOrganization && rows.length === 0)
    )
      throw new Error('snapshot_expired');
    const end = ordinal + rows.length;
    return decodeUnorganizedSelectionPage({
      schemaVersion: 1,
      selectionId,
      capturedAt: Number(snapshot.captured_at),
      expiresAt: Number(snapshot.expires_at),
      inventoryRevision: String(snapshot.inventory_revision),
      completeCoverage: true,
      summary,
      items: rows.map((row) => ({
        mediaLinkId: String(row.media_link_id),
        trackId: String(row.track_id),
        title: String(row.title),
        artist: row.artist === null ? null : String(row.artist),
        album: row.album === null ? null : String(row.album),
      })),
      nextCursor:
        end < summary.needsOrganization
          ? makeCursor(selectionId, end, scope.scopeHash, String(snapshot.inventory_revision))
          : null,
    });
  };

  return {
    create(input: {
      scope: SnapshotScope;
      inventoryRevision: string;
      pageSize?: number;
      capture(append: (item: UnorganizedSelectionItem) => void): UnorganizedSelectionSummary;
    }): UnorganizedSelectionPage {
      return atomic(() => {
        const now = options.clock();
        db.prepare(
          'DELETE FROM organization_selection_snapshots WHERE id IN (SELECT id FROM organization_selection_snapshots WHERE expires_at<=? ORDER BY expires_at LIMIT 100)',
        ).run(now);
        const snapshots = Number(
          db.prepare('SELECT count(*) AS n FROM organization_selection_snapshots').get()!.n,
        );
        const stored = Number(
          db.prepare('SELECT count(*) AS n FROM organization_selection_snapshot_items').get()!.n,
        );
        if (
          snapshots >= options.limits.snapshotMaxCount ||
          stored >= options.limits.snapshotMaxItems
        )
          throw new Error('snapshot_capacity');
        const selectionId = randomUUID();
        db.prepare(
          "INSERT INTO organization_selection_snapshots(id,actor_token_id,scope_hash,inventory_revision,captured_at,expires_at,summary_json) VALUES(?,?,?,?,?,?,'{}')",
        ).run(
          selectionId,
          input.scope.actorTokenId,
          input.scope.scopeHash,
          input.inventoryRevision,
          now,
          now + options.limits.snapshotMaxAgeMs,
        );
        let count = 0;
        const summary = input.capture((item) => {
          if (stored + count >= options.limits.snapshotMaxItems)
            throw new Error('snapshot_capacity');
          db.prepare(
            'INSERT INTO organization_selection_snapshot_items(selection_id,ordinal,media_link_id,track_id,title,artist,album) VALUES(?,?,?,?,?,?,?)',
          ).run(
            selectionId,
            count++,
            item.mediaLinkId,
            item.trackId,
            item.title,
            item.artist,
            item.album,
          );
        });
        if (summary.needsOrganization !== count) throw new Error('snapshot_incomplete');
        db.prepare('UPDATE organization_selection_snapshots SET summary_json=? WHERE id=?').run(
          JSON.stringify(summary),
          selectionId,
        );
        return readPage(input.scope, selectionId, 0, input.pageSize ?? 100);
      });
    },
    page(input: {
      scope: SnapshotScope;
      selectionId: string;
      cursor: string;
      limit?: number;
    }): UnorganizedSelectionPage {
      return atomic(() => {
        const cursor = decodeCursor(input.cursor);
        if (cursor.selectionId !== input.selectionId) throw new Error('invalid_cursor');
        const snapshot = db
          .prepare(
            'SELECT scope_hash,inventory_revision FROM organization_selection_snapshots WHERE id=?',
          )
          .get(input.selectionId);
        if (!snapshot) throw new Error('snapshot_expired');
        if (
          cursor.scopeHash !== input.scope.scopeHash ||
          cursor.inventoryRevision !== snapshot.inventory_revision
        )
          throw new Error('snapshot_scope_changed');
        return readPage(input.scope, input.selectionId, cursor.ordinal, input.limit ?? 100);
      });
    },
  };
}
