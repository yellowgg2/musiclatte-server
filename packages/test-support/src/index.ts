import type { HealthResponse } from '@musiclatte/contracts';

/** Synthetic, credential-free response fixture. */
export function createHealthFixture(): HealthResponse {
  return { status: 'ok' };
}
export { createFakeSubsonic } from './fake-subsonic.js';
export { subsonicFixture, subsonicErrorFixture } from './subsonic-fixtures.js';
export type { SubsonicScenario } from './fake-subsonic.js';
