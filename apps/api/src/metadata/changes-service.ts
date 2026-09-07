import type { SessionService } from '../auth/session-service.js';
import { ApiError } from '../auth/session-service.js';
import type { MetadataProvider } from './provider.js';
import type { VerifiedMetadataSession as Verified } from './resolver.js';

interface Cursor {
  phase: 'snapshot' | 'delta';
  asOf: number;
  after: number;
}
export function createMetadataChangesService(service: SessionService, p: MetadataProvider) {
  const db = p.options.database.connection;
  const accessible = async (v: Verified, row: Record<string, unknown>) => {
    const library = p.options.policy.libraries.find((entry) => entry.id === row.library_id);
    if (!library) return false;
    try {
      const { song, path } = await v.upstream.recentSong(String(row.current_track_id));
      service.find(v.session.token, v.session.scheme);
      return (
        song.id === row.current_track_id &&
        !song.isDir &&
        path !== null &&
        path === row.relative_file_key &&
        path.startsWith(`${library.relativeRoot}/`)
      );
    } catch {
      return false;
    }
  };
  const related = (row: Record<string, unknown>) => {
    const value = JSON.parse(String(row.related_ids_json)) as Record<string, unknown>;
    const result: Record<'trackIds' | 'albumIds' | 'artistIds' | 'coverIds', string[]> = {
      trackIds: [],
      albumIds: [],
      artistIds: [],
      coverIds: [],
    };
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      const ids = value[key];
      if (
        !Array.isArray(ids) ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !id.length || id.length > 2048)
      )
        throw new Error('Storage unavailable');
      result[key] = ids as string[];
    }
    return result;
  };
  const selection =
    'SELECT c.*,i.original_track_id,i.current_track_id,i.file_saved_at,i.reflected_at,l.relative_file_key FROM metadata_changes c JOIN metadata_items i ON i.id=c.item_id JOIN media_links l ON l.id=c.media_link_id';
  return {
    async list(v: Verified, query: { cursor?: string; limit?: string }) {
      const libraries = await p.allowedLibraries(v);
      const scope = [
        p.identity(v),
        v.session.instanceId,
        v.session.policyRevision,
        p.options.policy,
        libraries,
      ];
      const wrap = (cursor: Cursor) => {
        const raw = Buffer.from(JSON.stringify(cursor)).toString('base64url');
        return `${raw}.${service.sign('metadata-changes-cursor', JSON.stringify([scope, raw]))}`;
      };
      let cursor: Cursor = {
        phase: 'snapshot',
        asOf: Number(
          db.prepare('SELECT COALESCE(max(sequence),0) AS n FROM metadata_changes').get()!.n,
        ),
        after: 0,
      };
      if (query.cursor) {
        try {
          const value = JSON.parse(
            Buffer.from(query.cursor.split('.')[0]!, 'base64url').toString(),
          ) as Cursor;
          if (
            !value ||
            !['snapshot', 'delta'].includes(value.phase) ||
            ![value.asOf, value.after].every(
              (number) => Number.isSafeInteger(number) && number >= 0,
            ) ||
            !service.matches(wrap(value), query.cursor)
          )
            throw new Error();
          cursor = value;
        } catch {
          throw new ApiError(400, 'invalid_request');
        }
      }
      const limit = Number(query.limit ?? 25);
      const rows = db
        .prepare(
          `${selection} WHERE c.library_id IN (SELECT value FROM json_each(?)) AND c.sequence>? ${cursor.phase === 'snapshot' ? 'AND c.sequence<=? AND NOT EXISTS (SELECT 1 FROM metadata_changes newer WHERE newer.media_link_id=c.media_link_id AND newer.sequence>c.sequence AND newer.sequence<=?)' : ''} ORDER BY c.sequence LIMIT ?`,
        )
        .all(
          JSON.stringify(libraries),
          cursor.after,
          ...(cursor.phase === 'snapshot' ? [cursor.asOf, cursor.asOf] : []),
          limit + 1,
        );
      const page = rows.slice(0, limit);
      const changes = [];
      for (const row of page) {
        if (!(await accessible(v, row))) continue;
        changes.push({
          sequence: Number(row.sequence),
          libraryId: String(row.library_id),
          oldTrackId: String(row.original_track_id),
          newTrackId: String(row.current_track_id),
          oldRevision: String(row.old_revision),
          newRevision: String(row.new_revision),
          coverGeneration: String(row.cover_generation),
          relatedIds: related(row),
          changedFields: JSON.parse(String(row.changed_fields_json)) as string[],
          fileSavedAt: Number(row.file_saved_at),
          reflectedAt: row.reflected_at === null ? null : Number(row.reflected_at),
          reflection: String(row.reflection_result),
        });
      }
      const hasMore = rows.length > limit;
      const last = page.at(-1);
      const next: Cursor =
        cursor.phase === 'snapshot' && !hasMore
          ? { phase: 'delta', asOf: cursor.asOf, after: cursor.asOf }
          : { ...cursor, after: last ? Number(last.sequence) : cursor.after };
      return { schemaVersion: 1 as const, changes, hasMore, nextCursor: wrap(next) };
    },
    async authorizeCover(v: Verified, id: string, revision: string) {
      const libraries = await p.allowedLibraries(v);
      const rows = db
        .prepare(
          `${selection} WHERE c.cover_generation=? AND c.library_id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM json_each(c.related_ids_json,'$.coverIds') WHERE value=?) ORDER BY c.sequence DESC LIMIT 100`,
        )
        .all(revision, JSON.stringify(libraries), id);
      for (const row of rows)
        if (related(row).coverIds.includes(id) && (await accessible(v, row))) return;
      throw new ApiError(404, 'not_found');
    },
  };
}
