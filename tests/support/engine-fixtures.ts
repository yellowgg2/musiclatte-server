import { enginePublicStatuses, type EngineStatusResponse } from '@musiclatte/contracts';
export function engineFixture(overrides: Partial<EngineStatusResponse> = {}): EngineStatusResponse {
  return {
    schemaVersion: 1,
    channel: 'nightly',
    activeVersion: 'nightly-2026.09.07',
    candidateVersion: null,
    previousVersion: 'nightly-2026.09.06',
    lastCheckedAt: 1788739200000,
    lastSuccessfulCheckAt: 1788739200000,
    status: 'active',
    recoverability: 'available',
    ...overrides,
  };
}
export const engineFixtures = Object.fromEntries(
  enginePublicStatuses.map((status) => [
    status,
    engineFixture({
      status,
      ...(status === 'never_checked'
        ? {
            lastCheckedAt: null,
            lastSuccessfulCheckAt: null,
            previousVersion: null,
            recoverability: 'no_previous',
          }
        : {}),
      ...(status === 'candidate_pending_validation'
        ? { candidateVersion: 'nightly-2026.09.08' }
        : {}),
    }),
  ]),
);
