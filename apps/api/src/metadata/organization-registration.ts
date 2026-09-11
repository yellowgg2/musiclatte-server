import { randomUUID } from 'node:crypto';
import type { MetadataTagSnapshot } from './helper-client.js';
import type { ManagementDatabase } from '../storage/database.js';
import type { OrganizationClaim } from '../storage/organization-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { createExactPathLookup } from '../subsonic/exact-path-lookup.js';
import { createScanCoordinator } from '../subsonic/scan-coordinator.js';
import { sanitizeMediaName } from '../imports/file-keys.js';
import { curationSnapshot } from '../curation/reconciliation.js';

interface RegistrationRepositoryPort {
  transition(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'scanning' | 'recovery_required';
      errorCode?: string;
    },
  ): unknown;
  resumeRecovery(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      stage: 'scanning';
    },
  ): unknown;
  rebindCurrent(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      newTrackId: string;
      targetFileIdentity: string;
    },
  ): { trackRef: string | null };
  completeRegistration(
    input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
      newTrackId: string;
    },
  ): unknown;
}

function scalar(value: string | null) {
  return value?.normalize('NFC').trim() || undefined;
}

/** gonic's standard projection is verified independently from file-only albumArtist/lyrics. */
export function verifyOrganizationProjection(
  song: Record<string, unknown>,
  snapshot: MetadataTagSnapshot,
  targetKey: string,
) {
  const title = scalar(snapshot.values.title);
  const artist = snapshot.values.artist.map((value) => value.normalize('NFC').trim()).find(Boolean);
  const album = scalar(snapshot.values.album);
  const track = snapshot.values.trackNumber?.match(/^([1-9]\d*)/)?.[1];
  const year = snapshot.values.year?.match(/^(\d{4})/)?.[1];
  const genre = snapshot.values.genre.map((value) => value.normalize('NFC').trim()).find(Boolean);
  const albumDirectory = targetKey.split('/').at(-2);
  if (
    !title ||
    !artist ||
    !album ||
    song.title !== title ||
    song.artist !== artist ||
    song.album !== album ||
    (track !== undefined && Number(song.track) !== Number(track)) ||
    (year !== undefined && Number(song.year) !== Number(year)) ||
    (genre !== undefined && song.genre !== genre) ||
    albumDirectory !== sanitizeMediaName(album)
  )
    throw new Error('projection_mismatch');
}

export function createOrganizationRegistration(options: {
  database: ManagementDatabase;
  clock(): number;
  timeoutMs: number;
  pollMs: number;
  retryMs: number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  scanClient: Pick<
    SubsonicClient,
    'getScanStatus' | 'startScan' | 'indexes' | 'registrationDirectory' | 'recentSong'
  >;
  libraries: readonly { id: string; musicFolderId: string; relativeRoot: string }[];
  repository: RegistrationRepositoryPort;
  inspect(
    key: string,
    signal?: AbortSignal,
  ): Promise<{ snapshot: MetadataTagSnapshot; audioIdentity: string }>;
  sourceAbsent(key: string, signal?: AbortSignal): Promise<boolean>;
  fileIdentity(libraryId: string, key: string): string;
  revision(libraryId: string, key: string, digest: string): string;
  reconcile(trackRef: string, snapshot: MetadataTagSnapshot, revision: string): unknown;
}) {
  const coordinator = createScanCoordinator(options);
  const fence = (claim: OrganizationClaim) => ({
    itemId: claim.itemId,
    workerId: claim.workerId,
    generation: claim.generation,
  });
  return {
    async process(claim: OrganizationClaim, external?: AbortSignal) {
      if (!['moved', 'recovery_required'].includes(claim.stage))
        throw new Error('invalid_transition');
      if (claim.stage === 'recovery_required')
        options.repository.resumeRecovery({ ...fence(claim), stage: 'scanning' });
      else options.repository.transition({ ...fence(claim), stage: 'scanning' });
      const owner = randomUUID();
      let acquired = false;
      const controller = new AbortController();
      const abort = () => controller.abort();
      external?.addEventListener('abort', abort, { once: true });
      if (external?.aborted) abort();
      const timer = setTimeout(abort, options.timeoutMs);
      const signal = controller.signal;
      const deadline = options.clock() + options.timeoutMs;
      const owned = () => {
        signal.throwIfAborted();
        if (options.clock() >= deadline || !coordinator.owns(owner))
          throw new Error('registration_timeout');
      };
      try {
        acquired = coordinator.acquire(owner);
        if (!acquired) throw new Error('registration_pending');
        if (!(await options.scanClient.getScanStatus({ signal })).scanning) {
          owned();
          await options.scanClient.startScan({ signal });
        }
        while (true) {
          owned();
          if (!(await options.scanClient.getScanStatus({ signal })).scanning) break;
          await options.wait(
            Math.min(options.pollMs, Math.max(1, deadline - options.clock())),
            signal,
          );
        }
        owned();
        const library = options.libraries.find((entry) => entry.id === claim.libraryId);
        if (!library) throw new Error('registration_path');
        const lookup = createExactPathLookup(options.scanClient, { signal, assertOwned: owned });
        const newTrackId = await lookup(library, claim.targetKey);
        const current = await options.scanClient.recentSong(newTrackId, { signal });
        if (
          current.song.id !== newTrackId ||
          current.song.isDir ||
          current.path !== claim.targetKey ||
          !(await options.sourceAbsent(claim.sourceKey, signal))
        )
          throw new Error('registration_path');
        const inspected = await options.inspect(claim.targetKey, signal);
        if (inspected.audioIdentity !== claim.audioIdentity) throw new Error('audio_mismatch');
        verifyOrganizationProjection(
          current.song as unknown as Record<string, unknown>,
          inspected.snapshot,
          claim.targetKey,
        );
        owned();
        const targetFileIdentity = options.fileIdentity(claim.libraryId, claim.targetKey);
        const revision = options.revision(
          claim.libraryId,
          claim.targetKey,
          inspected.snapshot.fullDigest,
        );
        const rebound = options.repository.rebindCurrent({
          ...fence(claim),
          newTrackId,
          targetFileIdentity,
        });
        if (rebound.trackRef) options.reconcile(rebound.trackRef, inspected.snapshot, revision);
        options.repository.completeRegistration({ ...fence(claim), newTrackId });
        coordinator.release(owner, false);
      } catch (cause) {
        if (acquired && coordinator.owns(owner)) coordinator.release(owner, true);
        const code = cause instanceof Error ? cause.message : 'registration_upstream';
        options.repository.transition({
          ...fence(claim),
          stage: 'recovery_required',
          errorCode: code,
        });
        throw cause;
      } finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', abort);
      }
    },
  };
}
