import { randomUUID } from 'node:crypto';
import { ApiError, type SessionService } from '../auth/session-service.js';
import type { ManagementDatabase } from '../storage/database.js';
import { createMediaLinkRepository } from '../storage/media-link-repository.js';
import { validateRelativeKey } from '../imports/policy.js';
import { createMetadataRevision } from './revision.js';
import { canEditMetadata, canRestoreMetadata, type MetadataPolicy } from './policy.js';
import type { createMetadataFileAccess, MetadataFileInspection } from './file-access.js';

export type VerifiedMetadataSession = Awaited<ReturnType<SessionService['verify']>>;
export interface ResolvedMetadataFile {
  mediaLinkId: string;
  fileRevision: string;
  editable: boolean;
  reason: 'read_only' | 'unsupported_format' | null;
  /** Private worker/service inputs; explicitly project public DTOs at the API boundary. */
  libraryId: string;
  relativeFileKey: string;
  fileIdentity: string;
  bindingRevision: number;
  trackId: string;
  inspection: MetadataFileInspection;
}
export function createMetadataFileResolver(options: {
  database: ManagementDatabase;
  clock: () => number;
  policy: MetadataPolicy;
  sessionService: SessionService;
  signingKey: Uint8Array;
  fileAccess: ReturnType<typeof createMetadataFileAccess>;
  workerReady: () => boolean;
}) {
  const links = createMediaLinkRepository(options);
  const revision = createMetadataRevision(options.signingKey);
  return {
    async resolve(
      verified: VerifiedMetadataSession,
      trackId: string,
      mode: 'read' | 'edit' | 'restore' = 'edit',
      signal?: AbortSignal,
    ): Promise<ResolvedMetadataFile> {
      if (
        typeof trackId !== 'string' ||
        !trackId.length ||
        trackId.length > 2048 ||
        /[\u0000-\u001f\u007f]/.test(trackId)
      )
        throw new ApiError(400, 'invalid_request');
      const { sessionService, policy } = options;
      sessionService.find(verified.session.token, verified.session.scheme);
      if (!policy.enabled) throw new ApiError(403, 'forbidden');
      let result: Awaited<ReturnType<VerifiedMetadataSession['upstream']['recentSong']>>;
      let folderIds: string[];
      try {
        const requestOptions = signal ? { signal } : {};
        result = await verified.upstream.recentSong(trackId, requestOptions);
        folderIds = (await verified.upstream.folders(requestOptions)).map((folder) => folder.id);
      } catch (error) {
        return sessionService.rejectUpstream(error, verified.session.raw);
      }
      sessionService.find(verified.session.token, verified.session.scheme);
      if (result.song.id !== trackId || result.song.isDir || !result.path)
        throw new ApiError(409, 'conflict');
      let key: string;
      try {
        key = validateRelativeKey(result.path);
      } catch {
        throw new ApiError(409, 'conflict');
      }
      const candidates = policy.libraries.filter(
        (library) =>
          folderIds.includes(library.musicFolderId) && key.startsWith(`${library.relativeRoot}/`),
      );
      if (candidates.length !== 1) throw new ApiError(403, 'forbidden');
      const library = candidates[0]!;
      const identity = { ...verified.identity, musicFolderIds: folderIds };
      const authorized =
        mode === 'restore'
          ? identity.adminRole && policy.restoreManagers.includes(identity.username)
          : library.editors.includes(identity.username);
      if (mode !== 'read' && !authorized) throw new ApiError(403, 'forbidden');
      const inspection = await options.fileAccess.inspect(key, signal);
      sessionService.find(verified.session.token, verified.session.scheme);
      const existing = links.findBySongId(library.id, trackId);
      if (existing && existing.relativeFileKey !== key) throw new ApiError(409, 'conflict');
      let link;
      try {
        link = links.bindVerified({
          id: randomUUID(),
          libraryId: library.id,
          relativeFileKey: key,
          gonicSongId: trackId,
        });
      } catch {
        throw new ApiError(409, 'conflict');
      }
      const supported = /\.mp3$/i.test(key);
      const permission =
        mode === 'restore'
          ? canRestoreMetadata(policy, identity, library.id)
          : canEditMetadata(policy, identity.username, library.id);
      const editable = supported && permission && inspection.writable && options.workerReady();
      const scoped = { libraryId: library.id, relativeFileKey: key, digest: inspection.digest };
      return {
        mediaLinkId: link.id,
        fileRevision: revision.fileRevision(scoped),
        editable,
        reason: !supported ? 'unsupported_format' : editable ? null : 'read_only',
        libraryId: library.id,
        relativeFileKey: key,
        fileIdentity: revision.fileIdentity(scoped),
        bindingRevision: link.revision,
        trackId,
        inspection,
      };
    },
  };
}
