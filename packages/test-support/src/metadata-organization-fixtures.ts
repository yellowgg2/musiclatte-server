import type { OrganizationStatusResponse } from '@musiclatte/contracts';

/** Synthetic five-state response fixture with no user, credential, path, or media metadata. */
export function createOrganizationStatusFixture(): OrganizationStatusResponse {
  return {
    schemaVersion: 1,
    capturedAt: 1_000,
    items: [
      {
        target: { kind: 'track', trackId: 'track-organized' },
        state: 'organized',
        reason: 'verified',
        stage: 'succeeded',
        changedAt: 900,
      },
      {
        target: { kind: 'track', trackId: 'track-needs-organization' },
        state: 'needs_organization',
        reason: 'never_organized',
        stage: null,
        changedAt: null,
      },
      {
        target: { kind: 'track', trackId: 'track-processing' },
        state: 'processing',
        reason: 'job_active',
        stage: 'moving',
        changedAt: 910,
      },
      {
        target: { kind: 'track', trackId: 'track-attention' },
        state: 'attention',
        reason: 'job_failed',
        stage: 'failed',
        changedAt: 920,
      },
      {
        target: { kind: 'track', trackId: 'track-unknown' },
        state: 'unknown',
        reason: 'identity_unavailable',
        stage: null,
        changedAt: null,
      },
    ],
  };
}
