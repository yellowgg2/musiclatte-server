import type { OrganizationStage } from './organization-state.js';

export type IdentityResolution =
  'unchanged' | 'replacement_pending' | 'replacement_verified' | 'replacement_unresolved';

export interface OrganizationIdentityEdge {
  mediaLinkId: string;
  oldTrackId: string;
  newTrackId: string | null;
  stage: OrganizationStage;
}

export const IDENTITY_CHAIN_MAX_HOPS = 32;

const pendingStages = new Set<OrganizationStage>([
  'scanning',
  'rebound',
  'migrating_references',
  'verifying',
]);

export function resolveIdentity(input: {
  mediaLinkId: string;
  originalTrackId: string;
  currentTrackId: string;
  organizationEdges: readonly OrganizationIdentityEdge[];
}): IdentityResolution {
  if (input.originalTrackId === input.currentTrackId) return 'unchanged';

  const edges = input.organizationEdges.filter(
    (edge) => edge.mediaLinkId === input.mediaLinkId && edge.newTrackId,
  );
  const visited = new Set<string>();
  let trackId = input.originalTrackId;
  let hops = 0;

  while (trackId !== input.currentTrackId) {
    if (visited.has(trackId)) return 'replacement_unresolved';
    visited.add(trackId);

    const succeededTargets = new Set(
      edges
        .filter((edge) => edge.stage === 'succeeded' && edge.oldTrackId === trackId)
        .map((edge) => edge.newTrackId!),
    );
    if (succeededTargets.size > 1) return 'replacement_unresolved';
    if (succeededTargets.size === 1) {
      if (hops >= IDENTITY_CHAIN_MAX_HOPS) return 'replacement_unresolved';
      trackId = succeededTargets.values().next().value!;
      hops += 1;
      continue;
    }

    const pendingTargets = new Set(
      edges
        .filter((edge) => pendingStages.has(edge.stage) && edge.oldTrackId === trackId)
        .map((edge) => edge.newTrackId!),
    );
    return pendingTargets.size === 1 && pendingTargets.has(input.currentTrackId)
      ? 'replacement_pending'
      : 'replacement_unresolved';
  }

  return 'replacement_verified';
}
