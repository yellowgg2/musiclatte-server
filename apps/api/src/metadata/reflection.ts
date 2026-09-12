import type { MusicEntry, MetadataField } from '@musiclatte/contracts';
import type { MetadataTagSnapshot } from './helper-client.js';
/** Standard gonic v0.22.0 projection; unsupported fields remain file-only evidence. */
export function compareMetadataProjection(
  snapshot: MetadataTagSnapshot,
  song: MusicEntry,
  profile: { filename: string; coverMatches: boolean },
  requiredFields?: readonly MetadataField[],
) {
  const values = snapshot.values;
  const required = requiredFields ? new Set(requiredFields) : null;
  const verified: MetadataField[] = [];
  const mismatched: MetadataField[] = [];
  const compare = (field: MetadataField, matches: boolean) => {
    if (!required || required.has(field)) (matches ? verified : mismatched).push(field);
  };
  compare('title', song.title === (values.title || profile.filename));
  const artists = values.artist.length ? values.artist : values.albumArtist;
  compare('artist', artists.length ? artists.includes(song.artist ?? '') : !song.artist);
  compare('album', (song.album ?? '') === (values.album ?? ''));
  compare(
    'trackNumber',
    (song.track ?? 0) === (values.trackNumber ? Number.parseInt(values.trackNumber, 10) : 0),
  );
  compare('year', (song.year ?? 0) === (values.year ? Number.parseInt(values.year, 10) : 0));
  compare('genre', values.genre.length ? values.genre.includes(song.genre ?? '') : !song.genre);
  compare('cover', profile.coverMatches);
  return {
    status: mismatched.length ? ('reflection_mismatch' as const) : ('verified' as const),
    fileVerifiedFields: [
      'title',
      'artist',
      'album',
      'albumArtist',
      'trackNumber',
      'year',
      'genre',
      'cover',
      'lyrics',
    ] as MetadataField[],
    indexVerifiedFields: verified,
    unsupportedProjection: ['albumArtist', 'lyrics'] as MetadataField[],
    mismatched,
  };
}

import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagementDatabase } from '../storage/database.js';
import type { createMetadataRepository, MetadataClaim } from '../storage/metadata-repository.js';
import type { MetadataWork } from './worker.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { createScanCoordinator } from '../subsonic/scan-coordinator.js';
import { createExactPathLookup, ExactPathFailure } from '../subsonic/exact-path-lookup.js';
import { captureMetadataReferences, compareMetadataReferences } from './reference-check.js';
export interface MetadataReflectorOptions {
  database: ManagementDatabase;
  repository: ReturnType<typeof createMetadataRepository>;
  scanClient: Pick<
    SubsonicClient,
    'getScanStatus' | 'startScan' | 'indexes' | 'registrationDirectory'
  >;
  libraries: readonly { id: string; musicFolderId: string; relativeRoot: string }[];
  accountClient(work: MetadataWork): Promise<SubsonicClient>;
  fileSnapshot(work: MetadataWork): Promise<MetadataTagSnapshot>;
  coverMatches(
    work: MetadataWork,
    snapshot: MetadataTagSnapshot,
    song: MusicEntry,
    client: SubsonicClient,
  ): Promise<boolean>;
  refreshCoverCache?(ids: readonly string[]): Promise<void> | void;
  clock(): number;
  timeoutMs?: number;
  pollMs?: number;
  retryMs?: number;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
  reportFailure?(failure: {
    phase:
      | 'file_snapshot'
      | 'references'
      | 'account'
      | 'scan'
      | 'lookup'
      | 'song'
      | 'cover_cache'
      | 'cover_compare'
      | 'record';
    code: string;
  }): void;
}
export function createMetadataReflector(options: MetadataReflectorOptions) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const pollMs = options.pollMs ?? 1000;
  const retryMs = options.retryMs ?? 30000;
  for (const value of [timeoutMs, pollMs, retryMs])
    if (!Number.isSafeInteger(value) || value < 1 || value > 3600000)
      throw new Error('invalid_metadata_config');
  if (pollMs > timeoutMs) throw new Error('invalid_metadata_config');
  const repo = options.repository;
  const coordinator = createScanCoordinator({
    database: options.database,
    clock: options.clock,
    timeoutMs,
    retryMs,
  });
  const wait =
    options.wait ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  async function reflect(
    claim: MetadataClaim,
    work: MetadataWork,
    external?: AbortSignal,
  ): Promise<void> {
    repo.assertClaim(claim);
    if (work.stage === 'file_saved') repo.transition({ ...claim, stage: 'reflecting' });
    else if (work.stage !== 'reflecting') throw new Error('conflict');
    const owner = randomUUID();
    if (!coordinator.acquire(owner)) {
      repo.deferReflection(claim, retryMs);
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const signal = controller.signal;
    const deadline = options.clock() + timeoutMs;
    let retry = true;
    const owned = () => {
      signal.throwIfAborted();
      repo.assertClaim(claim);
      if (options.clock() >= deadline || !coordinator.owns(owner))
        throw new Error('reflection_unavailable');
    };
    const relatedIds = {
      trackIds: [work.trackId],
      albumIds: [] as string[],
      artistIds: [] as string[],
      coverIds: [] as string[],
    };
    const recordReferenceConflict = (reason: string) => {
      repo.recordReflection(claim, {
        status: 'reference_conflict',
        evidence: { reason },
        relatedIds,
      });
      retry = false;
      repo.transition({ ...claim, stage: 'conflict', errorCode: 'reference_conflict' });
    };
    const changedRevision = (digest: string) => {
      const superseded = repo.hasSavedSuccessor(claim, digest);
      repo.transition({
        ...claim,
        stage: superseded ? 'conflict' : 'recovery_required',
        errorCode: superseded ? 'revision_conflict' : 'write_uncertain',
      });
    };
    let phase: Parameters<NonNullable<MetadataReflectorOptions['reportFailure']>>[0]['phase'] =
      'file_snapshot';
    try {
      owned();
      const snapshot = await options.fileSnapshot(work);
      if (snapshot.fullDigest !== work.resultDigest) {
        changedRevision(snapshot.fullDigest);
        return;
      }
      phase = 'references';
      const references = repo.readReferences(claim);
      if (!references) {
        recordReferenceConflict('missing_baseline');
        return;
      }
      phase = 'account';
      const client = await options.accountClient(work);
      const library = options.libraries.find((value) => value.id === work.libraryId);
      if (!library) throw new Error('reflection_unavailable');
      phase = 'scan';
      if (!(await options.scanClient.getScanStatus({ signal })).scanning) {
        owned();
        await options.scanClient.startScan({ signal });
      }
      for (let round = 0; round <= Math.ceil(timeoutMs / pollMs); round++) {
        owned();
        if (!(await options.scanClient.getScanStatus({ signal })).scanning) {
          try {
            phase = 'lookup';
            const lookup = createExactPathLookup(options.scanClient, {
              signal,
              assertOwned: owned,
            });
            const id = await lookup(library, work.key);
            if (id !== work.trackId) {
              recordReferenceConflict('track_id_changed');
              return;
            }
            phase = 'song';
            const song = await client.getSong(id, { signal });
            phase = 'references';
            const afterReferences = await captureMetadataReferences(client, id, signal);
            owned();
            if (!compareMetadataReferences(references, afterReferences)) {
              recordReferenceConflict('account_references_changed');
              return;
            }
            if (song.albumId) relatedIds.albumIds.push(song.albumId);
            if (song.artistId) relatedIds.artistIds.push(song.artistId);
            if (song.coverArt) relatedIds.coverIds.push(song.coverArt);
            owned();
            phase = 'file_snapshot';
            const preRefreshDigest = (await options.fileSnapshot(work)).fullDigest;
            if (preRefreshDigest !== work.resultDigest) {
              changedRevision(preRefreshDigest);
              return;
            }
            owned();
            phase = 'cover_cache';
            await options.refreshCoverCache?.([
              ...new Set(
                [work.trackId, song.coverArt, song.albumId].filter((id): id is string =>
                  Boolean(id),
                ),
              ),
            ]);
            owned();
            const requiredFields = Object.keys(work.patch) as MetadataField[];
            phase = 'cover_compare';
            const evidence = compareMetadataProjection(
              snapshot,
              song,
              {
                filename: posix.basename(work.key),
                coverMatches: requiredFields.includes('cover')
                  ? await options.coverMatches(work, snapshot, song, client)
                  : true,
              },
              requiredFields,
            );
            phase = 'file_snapshot';
            const currentDigest = (await options.fileSnapshot(work)).fullDigest;
            if (currentDigest !== work.resultDigest) {
              changedRevision(currentDigest);
              return;
            }
            owned();
            phase = 'record';
            repo.recordReflection(claim, { status: evidence.status, evidence, relatedIds });
            retry = evidence.status !== 'verified';
            return;
          } catch (error) {
            if (!(error instanceof ExactPathFailure)) throw error;
          }
        }
        await wait(Math.min(pollMs, Math.max(1, deadline - options.clock())), signal);
      }
      throw new Error('reflection_unavailable');
    } catch (error) {
      options.reportFailure?.({
        phase,
        code:
          error instanceof ExactPathFailure
            ? error.code
            : error instanceof Error && /^[a-z][a-z0-9_]{0,63}$/.test(error.message)
              ? error.message
              : 'unavailable',
      });
      repo.assertClaim(claim);
      if (error instanceof Error && error.message === 'permission_changed') {
        retry = false;
        repo.transition({ ...claim, stage: 'recovery_required', errorCode: 'permission_changed' });
        return;
      }
      if (repo.readWork(claim).stage === 'reflecting')
        repo.recordReflection(claim, {
          status: 'reflection_unavailable',
          evidence: { reason: 'bounded_observation_unavailable' },
          relatedIds,
        });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
      coordinator.release(owner, retry);
      if (retry) {
        try {
          if (repo.readWork(claim).stage === 'reflecting') repo.deferReflection(claim, retryMs);
        } catch {
          /* A newer owner or terminal outcome owns the item. */
        }
      }
    }
  }
  return {
    reflect,
    retryReflection(itemId: string, identityKey: string) {
      return repo.requestReflectionRetry(itemId, identityKey);
    },
    async beforeWrite(claim: MetadataClaim, work: MetadataWork) {
      const client = await options.accountClient(work);
      const references = await captureMetadataReferences(client, work.trackId);
      repo.recordReferences(claim, references);
    },
    async runOnce(signal?: AbortSignal) {
      if (signal?.aborted || !coordinator.available()) return false;
      const claim = repo.claimNext({
        workerId: 'metadata-reflection',
        leaseDurationMs: timeoutMs + 5000,
        reflectionOnly: true,
      });
      if (!claim) return false;
      await reflect(claim, repo.readWork(claim), signal);
      return true;
    },
  };
}
