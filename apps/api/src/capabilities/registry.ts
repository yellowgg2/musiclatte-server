import { engineCapability } from '../engine/engine-service.js';
import { metadataReady, metadataCapability } from '../metadata/provider.js';
import { recentCapability } from '../imports/recent-service.js';
import { importCapability } from '../imports/import-service.js';
import {
  featureKeys,
  type CapabilitiesResponse,
  type FeatureCapability,
} from '@musiclatte/contracts';
import { upstreamError, type SessionService } from '../auth/session-service.js';
import { createAccessTokenService } from '../auth/access-token-service.js';

export async function capabilities(
  service: SessionService,
  verified: Awaited<ReturnType<SessionService['verify']>>,
): Promise<CapabilitiesResponse> {
  const { session, identity, upstream } = verified;
  const features: CapabilitiesResponse['features'] = Object.fromEntries(
    featureKeys.map((key) => [
      key,
      { supported: false, permission: 'denied', availability: 'available' },
    ]),
  );
  const standard: FeatureCapability = {
    supported: true,
    permission: 'allowed',
    availability: 'available',
  };
  features['music.browse'] = { ...standard };
  features['music.stream'] = { ...standard };
  features['playlists.read'] = { ...standard };
  features['playlists.write'] = { ...standard };
  features['favorites.songs'] = { ...standard };
  features['library.scan'] = {
    ...standard,
    permission: service.options.allowScan && identity.adminRole ? 'allowed' : 'denied',
  };
  try {
    await upstream.random({ size: 1 });
    service.rememberRandom(session.raw);
    features['library.randomSongs'] = { ...standard };
  } catch (error) {
    const mapped = upstreamError(error);
    if (mapped.status === 401) service.rejectUpstream(error, session.raw);
    features['library.randomSongs'] = {
      supported: service.knownRandom(session.raw) ? true : null,
      permission: mapped.status === 403 ? 'denied' : 'allowed',
      availability: mapped.status === 403 ? 'available' : 'temporarily_unavailable',
    };
  }
  if (service.options.mixes) features['mixes.saved'] = { ...features['library.randomSongs']! };
  features['library.recentDownloads'] = recentCapability(
    service.options.imports,
    identity.username,
  );
  features['imports.youtube'] = importCapability(service.options.imports, identity.username);
  const currentIdentity =
    service.options.imports?.policy.enabled || service.options.metadata?.policy.enabled
      ? (await service.verify(session.token, session.scheme)).identity
      : identity;
  features['engine.manage'] = engineCapability(service.options.imports, currentIdentity);
  let metadataLibraries: string[] = [];
  let metadataScopeUnknown = false;
  if (service.options.metadata?.policy.enabled) {
    try {
      const folders = (await upstream.folders()).map((folder) => folder.id);
      metadataLibraries = service.options.metadata.policy.libraries
        .filter((library) => folders.includes(library.musicFolderId))
        .map((library) => library.id);
    } catch (error) {
      if (upstreamError(error).status === 401) service.rejectUpstream(error, session.raw);
      metadataScopeUnknown = true;
    }
  }
  features['metadata.write'] = metadataCapability(
    service.options.metadata,
    currentIdentity.username,
    false,
    metadataLibraries,
  );
  features['metadata.lyrics.write'] = metadataCapability(
    service.options.metadata,
    currentIdentity.username,
    true,
    metadataLibraries,
  );
  if (metadataScopeUnknown)
    for (const key of ['metadata.write', 'metadata.lyrics.write'] as const)
      features[key] = {
        ...features[key]!,
        permission: 'unknown',
        availability: 'temporarily_unavailable',
      };
  const curation = service.options.automation?.curation;
  if (curation?.fence && service.options.metadata?.policy.enabled) {
    let ready = false;
    try {
      ready = metadataReady(service.options.metadata) && curation.ready?.() === true;
      service.options
        .automation!.database.connection.prepare(
          'SELECT claim_epoch FROM curation_state WHERE singleton=1',
        )
        .get();
    } catch {
      ready = false;
    }
    features['metadata.curation'] = {
      permission: features['metadata.write']!.permission,
      supported: true,
      availability: ready && !metadataScopeUnknown ? 'available' : 'temporarily_unavailable',
      fields: ['title', 'artist', 'album', 'cover', 'lyrics'],
      formats: ['mp3'],
    };
  }
  service.find(session.token, session.scheme);
  if (service.options.automation) {
    try {
      const libraries = await createAccessTokenService(
        service,
        service.options.automation,
      ).allowedLibraries(currentIdentity.username, upstream);
      features['automation.tokens'] = {
        supported: true,
        permission: libraries.length ? 'allowed' : 'denied',
        availability: 'available',
      };
    } catch (error) {
      if (upstreamError(error).status === 401) service.rejectUpstream(error, session.raw);
      features['automation.tokens'] = {
        supported: true,
        permission: 'unknown',
        availability: 'temporarily_unavailable',
      };
    }
    service.find(session.token, session.scheme);
  }
  return {
    schemaVersion: 1,
    instanceId: session.instanceId,
    revision: service.sign(
      'capability-revision',
      JSON.stringify([
        session.token,
        session.policyRevision,
        currentIdentity,
        features,
        service.options.imports?.policy,
        service.options.metadata?.policy,
      ]),
    ),
    features,
  };
}
