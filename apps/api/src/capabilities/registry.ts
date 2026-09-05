import {
  featureKeys,
  type CapabilitiesResponse,
  type FeatureCapability,
} from '@musiclatte/contracts';
import { upstreamError, type SessionService } from '../auth/session-service.js';

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
  service.find(session.token, session.scheme);
  return {
    schemaVersion: 1,
    instanceId: session.instanceId,
    revision: service.sign(
      'capability-revision',
      JSON.stringify([session.token, session.policyRevision, identity, features]),
    ),
    features,
  };
}
