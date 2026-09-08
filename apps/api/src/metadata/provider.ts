import { dirname, join } from 'node:path';
import type { FeatureCapability } from '@musiclatte/contracts';
import { metadataFields } from '@musiclatte/contracts';
import type { ManagementDatabase } from '../storage/database.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createMetadataFileAccess } from './file-access.js';
import { createMetadataHelper } from './helper-client.js';
import { createMetadataFileResolver, type VerifiedMetadataSession } from './resolver.js';
import { canEditMetadata, type MetadataPolicy } from './policy.js';

export interface MetadataOptions {
  database: ManagementDatabase;
  clock: () => number;
  policy: MetadataPolicy;
  runtime: Parameters<typeof createMetadataHelper>[0];
  uploadRoot: string;
  /** Only the validated file-write/reflection profile may opt in; a version probe is insufficient. */
  verifiedProfile: boolean;
  workerReady: () => boolean;
}
export function metadataReady(options: MetadataOptions): boolean {
  try {
    return options.verifiedProfile && options.workerReady();
  } catch {
    return false;
  }
}
export function metadataCapability(
  options: MetadataOptions | undefined,
  username: string,
  lyrics = false,
  permittedLibraries: readonly string[] = [],
): FeatureCapability {
  if (!options?.policy.enabled)
    return { supported: false, permission: 'denied', availability: 'available' };
  return {
    supported: true,
    permission: options.policy.libraries.some(
      (library) =>
        permittedLibraries.includes(library.id) &&
        canEditMetadata(options.policy, username, library.id),
    )
      ? 'allowed'
      : 'denied',
    availability: metadataReady(options) ? 'available' : 'temporarily_unavailable',
    formats: ['mp3'],
    fields: lyrics ? ['lyrics'] : [...metadataFields],
    bulkFields: lyrics
      ? []
      : metadataFields.filter((field) => field !== 'cover' && field !== 'lyrics'),
  };
}
export function createMetadataProvider(service: SessionService) {
  const options = service.options.metadata;
  if (!options?.policy.enabled) throw new ApiError(403, 'forbidden');
  let cachedAccess: ReturnType<typeof createMetadataFileAccess> | undefined;
  let cachedResolver: ReturnType<typeof createMetadataFileResolver> | undefined;
  let cachedHelper: ReturnType<typeof createMetadataHelper> | undefined;
  const getAccess = () =>
    (cachedAccess ??= createMetadataFileAccess({
      ...options.runtime,
      helperPath: join(dirname(options.runtime.helperPath), 'file_access.py'),
    }));
  const getResolver = () =>
    (cachedResolver ??= createMetadataFileResolver({
      ...options,
      sessionService: service,
      signingKey: service.options.signingKey,
      fileAccess: getAccess(),
      workerReady: () => metadataReady(options),
    }));
  const hash = (purpose: string, value: unknown) =>
    Buffer.from(service.sign(`metadata-${purpose}`, JSON.stringify(value)), 'base64url').toString(
      'hex',
    );
  const identity = (v: VerifiedMetadataSession) =>
    hash('identity', [v.session.instanceId, v.identity.username]);
  const allowedLibraries = async (v: VerifiedMetadataSession) => {
    let ids: string[];
    try {
      ids = (await v.upstream.folders()).map((folder) => folder.id);
    } catch (error) {
      return service.rejectUpstream(error, v.session.raw);
    }
    service.find(v.session.token, v.session.scheme);
    return options.policy.libraries
      .filter((library) => ids.includes(library.musicFolderId))
      .map((library) => library.id)
      .sort();
  };
  return {
    options,
    get resolver() {
      return getResolver();
    },
    get fileAccess() {
      return getAccess();
    },
    get helper() {
      return (cachedHelper ??= createMetadataHelper(options.runtime));
    },
    hash,
    identity,
    allowedLibraries,
  };
}
export type MetadataProvider = ReturnType<typeof createMetadataProvider>;
export async function metadataErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = error instanceof Error ? error.message : '';
    if (['conflict', 'revision_conflict', 'read_unstable'].includes(code))
      throw new ApiError(409, 'conflict');
    if (
      [
        'invalid_metadata',
        'invalid_cover',
        'ambiguous_selector',
        'unsupported_format',
        'unsupported_tag_layout',
      ].includes(code)
    )
      throw new ApiError(422, 'invalid_request');
    if (code === 'file_unavailable') throw new ApiError(404, 'not_found');
    if (code === 'Storage unavailable') throw new ApiError(503, 'storage_unavailable');
    throw new ApiError(503, 'upstream_unavailable');
  }
}
