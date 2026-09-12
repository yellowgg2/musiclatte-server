import type { MetadataReferences } from './reference-check.js';
import { decodeMetadataReferences } from './reference-check.js';
import type { OrganizationClaim } from '../storage/organization-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';

export const migrateReferenceSequence = (values: readonly string[], oldId: string, newId: string) =>
  values.map((value) => (value === oldId ? newId : value));

export const withoutReference = (values: readonly string[], oldId: string) =>
  values.filter((value) => value !== oldId);

const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

interface ReferenceRepositoryPort {
  readBaseline(claim: OrganizationClaim): MetadataReferences;
  transition(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'migrating_references' | 'verifying' | 'recovery_required';
      errorCode?: string;
    },
  ): unknown;
  completeVerifiedReferences(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'>,
  ): unknown;
  resumeRecovery(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'migrating_references';
    },
  ): unknown;
  referenceCheckpoints(itemId: string): Array<{
    kind: string;
    referenceId: string;
    status: string;
    errorCode: string | null;
  }>;
  putReferenceCheckpoint(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      kind: 'playlist' | 'star';
      referenceId: string;
      baseline: unknown;
      desired: unknown;
    },
  ): unknown;
  completeReferenceCheckpoint(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      kind: 'playlist' | 'star';
      referenceId: string;
    },
  ): unknown;
  failReferenceCheckpoint(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      kind: 'playlist' | 'star';
      referenceId: string;
      errorCode: string;
    },
  ): unknown;
}

type ReferenceClient = Pick<
  SubsonicClient,
  'getPlaylist' | 'createPlaylist' | 'getPlaylists' | 'getStarred2' | 'starSong'
>;

export function createReferenceMigration(options: {
  repository: ReferenceRepositoryPort;
  authorize(claim: OrganizationClaim): Promise<{ username: string; client: ReferenceClient }>;
}) {
  const fence = (claim: OrganizationClaim) => ({
    itemId: claim.itemId,
    workerId: claim.workerId,
    generation: claim.generation,
  });
  const ids = (playlist: Awaited<ReturnType<ReferenceClient['getPlaylist']>>) =>
    playlist.entry.map((entry) => entry.id);
  return {
    async process(claim: OrganizationClaim, signal?: AbortSignal) {
      if (!claim.newTrackId || !['rebound', 'recovery_required'].includes(claim.stage))
        throw new Error('invalid_transition');
      if (claim.stage === 'recovery_required')
        options.repository.resumeRecovery({ ...fence(claim), stage: 'migrating_references' });
      else options.repository.transition({ ...fence(claim), stage: 'migrating_references' });
      try {
        const { username, client } = await options.authorize(claim);
        const baseline = decodeMetadataReferences(options.repository.readBaseline(claim));
        if (baseline.trackId !== claim.oldTrackId) throw new Error('reference_conflict');
        const completed = new Set(
          options.repository
            .referenceCheckpoints(claim.itemId)
            .filter((checkpoint) => checkpoint.status === 'completed')
            .map((checkpoint) => `${checkpoint.kind}:${checkpoint.referenceId}`),
        );
        const request = signal ? { signal } : undefined;
        for (const entry of baseline.playlists) {
          const checkpoint = `playlist:${entry.id}`;
          if (completed.has(checkpoint)) continue;
          const desired = migrateReferenceSequence(
            entry.songIds,
            claim.oldTrackId,
            claim.newTrackId,
          );
          options.repository.putReferenceCheckpoint({
            ...fence(claim),
            kind: 'playlist',
            referenceId: entry.id,
            baseline: entry,
            desired,
          });
          let current = await client.getPlaylist(entry.id, request);
          const currentIds = ids(current);
          const metadataMatches =
            (entry.name === undefined || current.name === entry.name) &&
            (entry.owner === undefined || current.owner === entry.owner) &&
            current.owner === username;
          const allowed =
            same(currentIds, entry.songIds) ||
            same(currentIds, withoutReference(entry.songIds, claim.oldTrackId));
          if (!metadataMatches || (!allowed && !same(currentIds, desired))) {
            options.repository.failReferenceCheckpoint({
              ...fence(claim),
              kind: 'playlist',
              referenceId: entry.id,
              errorCode: 'reference_conflict',
            });
            throw new Error('reference_conflict');
          }
          if (!same(currentIds, desired)) {
            try {
              await client.createPlaylist({
                playlistId: entry.id,
                name: current.name,
                songIds: desired,
                ...(signal ? { signal } : {}),
              });
            } catch {
              // An uncertain write is decided only by exact authenticated readback.
            }
            current = await client.getPlaylist(entry.id, request);
          }
          if (!same(ids(current), desired)) {
            options.repository.failReferenceCheckpoint({
              ...fence(claim),
              kind: 'playlist',
              referenceId: entry.id,
              errorCode: 'reference_conflict',
            });
            throw new Error('reference_conflict');
          }
          options.repository.completeReferenceCheckpoint({
            ...fence(claim),
            kind: 'playlist',
            referenceId: entry.id,
          });
        }
        if (!completed.has('star:star')) {
          options.repository.putReferenceCheckpoint({
            ...fence(claim),
            kind: 'star',
            referenceId: 'star',
            baseline: baseline.starred,
            desired: baseline.starred,
          });
          let starred = (await client.getStarred2(request)).some(
            (entry) => entry.id === claim.newTrackId,
          );
          if (baseline.starred && !starred) {
            try {
              await client.starSong(claim.newTrackId, request);
            } catch {
              // Readback below owns the uncertain outcome.
            }
            starred = (await client.getStarred2(request)).some(
              (entry) => entry.id === claim.newTrackId,
            );
          }
          if (starred !== baseline.starred) {
            options.repository.failReferenceCheckpoint({
              ...fence(claim),
              kind: 'star',
              referenceId: 'star',
              errorCode: 'reference_conflict',
            });
            throw new Error('reference_conflict');
          }
          options.repository.completeReferenceCheckpoint({
            ...fence(claim),
            kind: 'star',
            referenceId: 'star',
          });
        }
        options.repository.transition({ ...fence(claim), stage: 'verifying' });
        const summaries = await client.getPlaylists(request);
        const actual: MetadataReferences['playlists'] = [];
        for (const summary of summaries) {
          const playlist = await client.getPlaylist(summary.id, request);
          if (ids(playlist).includes(claim.newTrackId))
            actual.push({
              id: playlist.id,
              name: playlist.name,
              owner: playlist.owner,
              songIds: ids(playlist),
            });
        }
        const expected = baseline.playlists.map((entry) => ({
          ...entry,
          songIds: migrateReferenceSequence(entry.songIds, claim.oldTrackId, claim.newTrackId!),
        }));
        actual.sort((a, b) => a.id.localeCompare(b.id));
        expected.sort((a, b) => a.id.localeCompare(b.id));
        const starred = (await client.getStarred2(request)).some(
          (entry) => entry.id === claim.newTrackId,
        );
        if (starred !== baseline.starred || JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error('reference_conflict');
        options.repository.completeVerifiedReferences(fence(claim));
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : 'reference_conflict';
        options.repository.transition({
          ...fence(claim),
          stage: 'recovery_required',
          errorCode: code,
        });
        throw cause;
      }
    },
  };
}
