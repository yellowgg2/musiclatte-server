import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { createAccessTokenRepository } from '../src/storage/access-token-repository.js';
import { createOrganizationSelectionRepository } from '../src/storage/organization-selection-repository.js';
import { createUnorganizedLibrarySelection } from '../src/metadata/organization-selection.js';

async function loadSelectionModule() {
  return import(resolve('apps/api/src/metadata/organization-selection.ts')).catch(() => ({}));
}

describe('organization collection selection', () => {
  /** First-occurrence ordering keeps every duplicate position without repeating track mutations. */
  it('should freeze duplicate occurrences into one ordered item per track', async () => {
    const module = await loadSelectionModule();
    expect(module).toHaveProperty('createOrganizationSelection');
    if (!('createOrganizationSelection' in module)) return;
    const revision = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const input = {
      capturedAt: 1000,
      source: { kind: 'playlist' as const, playlistId: 'pl-1', name: 'Synthetic List' },
      songs: [
        { id: 'A', title: 'First A', artist: 'Artist A', album: 'Album A', isDir: false },
        { id: 'B', title: 'B', isDir: false },
        { id: 'A', title: 'Second A', artist: 'Changed', isDir: false },
      ],
      actorCredentialFingerprint: 'credential',
      revision,
    };
    const result = module.createOrganizationSelection(input);
    expect(result).toEqual({
      schemaVersion: 1,
      capturedAt: 1000,
      source: input.source,
      selectionRevision: result.selectionRevision,
      occurrenceCount: 3,
      uniqueTrackCount: 2,
      items: [
        {
          trackId: 'A',
          title: 'First A',
          artist: 'Artist A',
          album: 'Album A',
          occurrenceIndexes: [0, 2],
        },
        {
          trackId: 'B',
          title: 'B',
          artist: null,
          album: null,
          occurrenceIndexes: [1],
        },
      ],
    });
    expect(module.createOrganizationSelection(input).selectionRevision).toBe(
      result.selectionRevision,
    );
    expect(
      module.createOrganizationSelection({
        ...input,
        songs: [input.songs[1]!, input.songs[0]!, input.songs[2]!],
      }).selectionRevision,
    ).not.toBe(result.selectionRevision);
  });

  /** Empty collections are valid, while the hard bound rejects instead of truncating. */
  it('should accept zero and 1000 items but reject 1001 occurrences', async () => {
    const module = await loadSelectionModule();
    expect(module).toHaveProperty('createOrganizationSelection');
    if (!('createOrganizationSelection' in module)) return;
    const base = {
      capturedAt: 1000,
      source: { kind: 'favorites' as const },
      actorCredentialFingerprint: 'credential',
      revision: () => 'a'.repeat(64),
    };
    expect(module.createOrganizationSelection({ ...base, songs: [] })).toMatchObject({
      occurrenceCount: 0,
      uniqueTrackCount: 0,
      items: [],
    });
    expect(
      module.createOrganizationSelection({
        ...base,
        songs: Array.from({ length: 1000 }, (_, index) => ({
          id: `track-${index}`,
          title: `Track ${index}`,
          isDir: false,
        })),
      }).occurrenceCount,
    ).toBe(1000);
    expect(() =>
      module.createOrganizationSelection({
        ...base,
        songs: Array.from({ length: 1001 }, (_, index) => ({
          id: `track-${index}`,
          title: `Track ${index}`,
          isDir: false,
        })),
      }),
    ).toThrow('selection_too_large');
  });

  /** Whole-library selection has its own durable, signed snapshot repository. */
  it('should expose a separate unorganized snapshot implementation', async () => {
    const selection = await loadSelectionModule();
    const repository = await import(
      resolve('apps/api/src/storage/organization-selection-repository.ts')
    ).catch(() => ({}));
    expect(selection).toHaveProperty('createUnorganizedLibrarySelection');
    expect(repository).toHaveProperty('createOrganizationSelectionRepository');
  });

  /** Classification preserves every public state count but stores only needs-organization rows. */
  it('should summarize mixed current inventory without selecting tombstones or foreign libraries', async () => {
    const c = await createTestContext();
    try {
      c.db.connection
        .prepare(
          "INSERT INTO curation_inventory_runs(library_id,generation,status,last_discovery_at,last_reconciled_at,event_sequence,checkpoint_json) VALUES('library-1','generation','ready',900,950,0,'{\"discoveryComplete\":true}')",
        )
        .run();
      const states = [
        'organized',
        'needs_organization',
        'processing',
        'attention',
        'unknown',
      ] as const;
      for (const [index, state] of states.entries()) {
        const mediaLinkId = `mixed-media-${index}`;
        const trackId = `mixed-track-${index}`;
        c.mediaLinks.create({
          id: mediaLinkId,
          libraryId: 'library-1',
          relativeFileKey: `Synthetic/${state}.mp3`,
          gonicSongId: trackId,
        });
        c.db.connection
          .prepare(
            "INSERT INTO curation_tracks(id,library_id,track_id,media_link_id,binding_revision,format,title,artist_json,album,base_status,policy_version,validation,tombstoned) VALUES(?,'library-1',?,?,1,'mp3',?,'[\"Artist\"]','Album','unreviewed','required-v1','verified',0)",
          )
          .run(`mixed-ref-${index}`, trackId, mediaLinkId, `Title ${index}`);
      }
      c.db.connection
        .prepare(
          "INSERT INTO curation_tracks(id,library_id,track_id,format,title,artist_json,base_status,policy_version,validation,tombstoned) VALUES('tombstone','library-1','old-track','mp3','Old','[]','unreviewed','required-v1','stale',1)",
        )
        .run();
      const captured: unknown[] = [];
      const result = createUnorganizedLibrarySelection({
        database: c.db,
        organization: {
          readOrganizationStatuses({ targets }: { targets: Array<{ mediaLinkId: string }> }) {
            return targets.map((target) => {
              const index = Number(target.mediaLinkId.split('-').at(-1));
              return {
                target,
                state: states[index]!,
                reason: index === 1 ? 'never_organized' : 'identity_unavailable',
                stage: null,
                changedAt: null,
              };
            });
          },
        } as never,
        snapshots: {
          create({ capture }: { capture(append: (item: unknown) => void): unknown }) {
            const summary = capture((item) => captured.push(item));
            return { summary };
          },
        } as never,
        allowedLibraryIds: ['library-1'],
        actorTokenId: 'token',
        scopeHash: 'a'.repeat(64),
        currentPolicyVersion: 'id3-managed-v1',
        revision: () => 'b'.repeat(64),
      }) as unknown as { summary: Record<string, number> };
      expect(result.summary).toEqual({
        total: 5,
        organized: 1,
        needsOrganization: 1,
        processing: 1,
        attention: 1,
        unknown: 1,
      });
      expect(captured).toEqual([
        {
          mediaLinkId: 'mixed-media-1',
          trackId: 'mixed-track-1',
          title: 'Title 1',
          artist: 'Artist',
          album: 'Album',
        },
      ]);
    } finally {
      c.cleanup();
    }
  });

  /** Dedicated storage pages 1001 items without sharing the legacy curation snapshot capacity. */
  it('should page a 1001-item signed snapshot and bind it to the exact token scope', async () => {
    const c = await createTestContext();
    try {
      const token = createAccessTokenRepository({
        database: c.db,
        vault: c.vault,
        clock: () => 1000,
        maxAgeMs: 10_000,
      }).create({
        name: 'Selection fixture',
        scopes: ['metadata:read', 'metadata:write', 'media:organize'],
        libraryIds: ['library-1'],
        expiresAt: 5000,
        proof,
      });
      let now = 1000;
      const repository = createOrganizationSelectionRepository({
        database: c.db,
        clock: () => now,
        cursorKey: new Uint8Array(32),
        limits: { snapshotMaxAgeMs: 1000, snapshotMaxItems: 2000, snapshotMaxCount: 2 },
      });
      const scope = { actorTokenId: token.accessToken.id, scopeHash: 'a'.repeat(64) };
      const first = repository.create({
        scope,
        inventoryRevision: 'b'.repeat(64),
        capture(append) {
          for (let index = 0; index < 1001; index++)
            append({
              mediaLinkId: `media-${index}`,
              trackId: `track-${index}`,
              title: `Synthetic ${index}`,
              artist: index % 2 ? null : 'Artist',
              album: null,
            });
          return {
            total: 1001,
            organized: 0,
            needsOrganization: 1001,
            processing: 0,
            attention: 0,
            unknown: 0,
          };
        },
      });
      expect(first.items).toHaveLength(100);
      const seen = [...first.items];
      let page = first;
      while (page.nextCursor) {
        page = repository.page({
          scope,
          selectionId: first.selectionId,
          cursor: page.nextCursor,
        });
        seen.push(...page.items);
      }
      expect(seen).toHaveLength(1001);
      expect(seen.map((item) => item.mediaLinkId)).toEqual(
        Array.from({ length: 1001 }, (_, index) => `media-${index}`),
      );
      expect(() =>
        repository.page({
          scope: { ...scope, scopeHash: 'c'.repeat(64) },
          selectionId: first.selectionId,
          cursor: first.nextCursor!,
        }),
      ).toThrow('snapshot_scope_changed');
      expect(() =>
        repository.page({
          scope,
          selectionId: first.selectionId,
          cursor: first.nextCursor! + 'x',
        }),
      ).toThrow('invalid_cursor');
      now = 2000;
      expect(() =>
        repository.page({
          scope,
          selectionId: first.selectionId,
          cursor: first.nextCursor!,
        }),
      ).toThrow('snapshot_expired');
      now = 1000;
      c.db.connection
        .prepare(
          'DELETE FROM organization_selection_snapshot_items WHERE selection_id=? AND ordinal=100',
        )
        .run(first.selectionId);
      expect(() =>
        repository.page({
          scope,
          selectionId: first.selectionId,
          cursor: first.nextCursor!,
        }),
      ).toThrow('snapshot_expired');
      expect(c.db.connection.prepare('SELECT count(*) AS n FROM curation_snapshots').get()!.n).toBe(
        0,
      );
    } finally {
      c.cleanup();
    }
  });

  /** Capacity failure rolls the new parent and every inserted ordinal back atomically. */
  it('should fail closed without a partial snapshot when item capacity is exhausted', async () => {
    const c = await createTestContext();
    try {
      const token = createAccessTokenRepository({
        database: c.db,
        vault: c.vault,
        clock: () => 1000,
        maxAgeMs: 10_000,
      }).create({
        name: 'Capacity fixture',
        scopes: ['metadata:read', 'metadata:write', 'media:organize'],
        libraryIds: ['library-1'],
        expiresAt: 5000,
        proof,
      });
      let now = 1000;
      const repository = createOrganizationSelectionRepository({
        database: c.db,
        clock: () => now,
        cursorKey: new Uint8Array(32),
        limits: { snapshotMaxAgeMs: 1000, snapshotMaxItems: 1, snapshotMaxCount: 1 },
      });
      expect(() =>
        repository.create({
          scope: { actorTokenId: token.accessToken.id, scopeHash: 'a'.repeat(64) },
          inventoryRevision: 'b'.repeat(64),
          capture(append) {
            for (let index = 0; index < 2; index++)
              append({
                mediaLinkId: `media-${index}`,
                trackId: `track-${index}`,
                title: `Synthetic ${index}`,
                artist: null,
                album: null,
              });
            return {
              total: 2,
              organized: 0,
              needsOrganization: 2,
              processing: 0,
              attention: 0,
              unknown: 0,
            };
          },
        }),
      ).toThrow('snapshot_capacity');
      expect(
        c.db.connection.prepare('SELECT count(*) AS n FROM organization_selection_snapshots').get()!
          .n,
      ).toBe(0);
      expect(
        c.db.connection
          .prepare('SELECT count(*) AS n FROM organization_selection_snapshot_items')
          .get()!.n,
      ).toBe(0);
      const empty = () =>
        repository.create({
          scope: { actorTokenId: token.accessToken.id, scopeHash: 'a'.repeat(64) },
          inventoryRevision: 'b'.repeat(64),
          capture: () => ({
            total: 0,
            organized: 0,
            needsOrganization: 0,
            processing: 0,
            attention: 0,
            unknown: 0,
          }),
        });
      const expired = empty();
      expect(() => empty()).toThrow('snapshot_capacity');
      now = expired.expiresAt;
      expect(empty().selectionId).not.toBe(expired.selectionId);
      expect(
        c.db.connection.prepare('SELECT count(*) AS n FROM organization_selection_snapshots').get()!
          .n,
      ).toBe(1);
    } finally {
      c.cleanup();
    }
  });
});
