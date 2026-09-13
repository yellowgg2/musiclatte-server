import type {
  MusicEntry,
  OrganizationSelection,
  OrganizationSelectionSource,
  OrganizationState,
  UnorganizedSelectionSummary,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/session-service.js';
import type { createOrganizationRepository } from '../storage/organization-repository.js';
import type { createOrganizationSelectionRepository } from '../storage/organization-selection-repository.js';

const maximumSelectionSize = 1000;

export function createOrganizationSelection(input: {
  capturedAt: number;
  source: OrganizationSelectionSource;
  songs: readonly Pick<MusicEntry, 'id' | 'title' | 'artist' | 'album' | 'isDir'>[];
  actorCredentialFingerprint: unknown;
  revision(value: unknown): string;
}): OrganizationSelection {
  if (input.songs.length > maximumSelectionSize) throw new ApiError(422, 'selection_too_large');
  const items: OrganizationSelection['items'] = [];
  const indexes = new Map<string, number>();
  input.songs.forEach((song, occurrenceIndex) => {
    const existing = indexes.get(song.id);
    if (existing !== undefined) {
      items[existing]!.occurrenceIndexes.push(occurrenceIndex);
      return;
    }
    indexes.set(song.id, items.length);
    items.push({
      trackId: song.id,
      title: song.title,
      artist: song.artist ?? null,
      album: song.album ?? null,
      occurrenceIndexes: [occurrenceIndex],
    });
  });
  if (items.length > maximumSelectionSize) throw new ApiError(422, 'selection_too_large');
  const selectionRevision = input.revision([
    input.actorCredentialFingerprint,
    input.source,
    items.map(({ trackId, occurrenceIndexes }) => [trackId, occurrenceIndexes]),
  ]);
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt,
    source: input.source,
    selectionRevision,
    occurrenceCount: input.songs.length,
    uniqueTrackCount: items.length,
    items,
  };
}

/** Freeze a complete current inventory into the separate whole-library snapshot store. */
export function createUnorganizedLibrarySelection(input: {
  database: import('../storage/database.js').ManagementDatabase;
  organization: ReturnType<typeof createOrganizationRepository>;
  snapshots: ReturnType<typeof createOrganizationSelectionRepository>;
  allowedLibraryIds: readonly string[];
  actorTokenId: string;
  scopeHash: string;
  currentPolicyVersion: string;
  revision(value: unknown): string;
  signal?: AbortSignal;
  pageSize?: number;
}) {
  input.signal?.throwIfAborted();
  const db = input.database.connection;
  const libraryIds = [...new Set(input.allowedLibraryIds)].sort();
  const incomplete: Array<{
    libraryId: string;
    status: 'missing' | 'discovering' | 'partial' | 'stale' | 'error' | 'retry_pending';
  }> = [];
  const runs = libraryIds.map((libraryId) => {
    const row = db
      .prepare(
        'SELECT library_id,generation,status,last_discovery_at,last_reconciled_at,event_sequence,checkpoint_json,last_error_code FROM curation_inventory_runs WHERE library_id=?',
      )
      .get(libraryId);
    let discoveryComplete = false;
    try {
      discoveryComplete = JSON.parse(String(row?.checkpoint_json))?.discoveryComplete === true;
    } catch {
      discoveryComplete = false;
    }
    if (!row) {
      incomplete.push({ libraryId, status: 'missing' });
      return {
        libraryId,
        generation: '',
        status: 'missing',
        lastDiscoveryAt: 0,
        lastReconciledAt: 0,
        eventSequence: 0,
      };
    }
    const retryPending = row
      ? !!db
          .prepare(
            "SELECT 1 FROM curation_inventory_queue WHERE library_id=? AND (status='pending' OR status='error' AND terminal=0) LIMIT 1",
          )
          .get(libraryId)
      : false;
    if (row.status !== 'ready' || !discoveryComplete || retryPending)
      incomplete.push({
        libraryId,
        status: retryPending
          ? 'retry_pending'
          : row.status === 'ready'
            ? 'partial'
            : (String(row.status) as 'discovering' | 'partial' | 'stale' | 'error'),
      });
    return {
      libraryId,
      generation: String(row.generation),
      status: String(row.status),
      lastDiscoveryAt: Number(row.last_discovery_at ?? 0),
      lastReconciledAt: Number(row.last_reconciled_at ?? 0),
      eventSequence: Number(row.event_sequence),
    };
  });
  if (incomplete.length)
    throw new ApiError(409, 'inventory_incomplete', undefined, { libraries: incomplete });
  const inventoryRevision = input.revision(runs);
  const summary: UnorganizedSelectionSummary = {
    total: 0,
    organized: 0,
    needsOrganization: 0,
    processing: 0,
    attention: 0,
    unknown: 0,
  };
  const stateKey: Record<OrganizationState, keyof UnorganizedSelectionSummary> = {
    organized: 'organized',
    needs_organization: 'needsOrganization',
    processing: 'processing',
    attention: 'attention',
    unknown: 'unknown',
  };
  return input.snapshots.create({
    scope: { actorTokenId: input.actorTokenId, scopeHash: input.scopeHash },
    inventoryRevision,
    ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    capture(append) {
      if (!libraryIds.length) return summary;
      const placeholders = libraryIds.map(() => '?').join(',');
      const pending: Array<{
        mediaLinkId: string;
        trackId: string;
        title: string;
        artist: string | null;
        album: string | null;
      }> = [];
      const flush = () => {
        if (!pending.length) return;
        input.signal?.throwIfAborted();
        const statuses = input.organization.readOrganizationStatuses({
          targets: pending.map((item) => ({
            kind: 'media_link' as const,
            mediaLinkId: item.mediaLinkId,
          })),
          allowedLibraryIds: libraryIds,
          currentPolicyVersion: input.currentPolicyVersion,
          requireInventoryIdentity: true,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        statuses.forEach((status, index) => {
          const item = pending[index]!;
          summary.total++;
          summary[stateKey[status.state]]++;
          if (status.state === 'needs_organization') append(item);
        });
        pending.length = 0;
      };
      for (const row of db
        .prepare(
          `SELECT c.media_link_id,c.track_id,c.title,c.artist_json,c.album
           FROM curation_tracks c
           WHERE c.library_id IN (${placeholders}) AND c.tombstoned=0
           ORDER BY c.library_id COLLATE BINARY,c.track_id COLLATE BINARY,c.id COLLATE BINARY`,
        )
        .iterate(...libraryIds)) {
        input.signal?.throwIfAborted();
        if (row.media_link_id === null) {
          summary.total++;
          summary.unknown++;
          continue;
        }
        let artists: unknown = [];
        try {
          artists = JSON.parse(String(row.artist_json));
        } catch {
          artists = [];
        }
        pending.push({
          mediaLinkId: String(row.media_link_id),
          trackId: String(row.track_id),
          title: typeof row.title === 'string' && row.title ? row.title : String(row.track_id),
          artist:
            Array.isArray(artists) && artists.every((artist) => typeof artist === 'string')
              ? artists.filter(Boolean).join(', ') || null
              : null,
          album: typeof row.album === 'string' && row.album ? row.album : null,
        });
        if (pending.length === 100) flush();
      }
      flush();
      return summary;
    },
  });
}
