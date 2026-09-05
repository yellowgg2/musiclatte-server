import type { HealthResponse } from '@musiclatte/contracts';

/** Synthetic, credential-free response fixture. */
export function createHealthFixture(): HealthResponse { return { status: 'ok' }; }
