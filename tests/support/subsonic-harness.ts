import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';

import type { SubsonicTokenProof } from '@musiclatte/contracts';
import type { SubsonicClientOptions } from '../../apps/api/src/subsonic/client.js';
import type { SubsonicScenario } from '../../packages/test-support/src/fake-subsonic.js';
import { subsonicErrorFixture } from '../../packages/test-support/src/subsonic-fixtures.js';

export type ClientOptions = SubsonicClientOptions;
export type Scenario = SubsonicScenario;
export const proof: SubsonicTokenProof = { username: 'fixture-listener', t: '0123456789abcdef0123456789abcdef', s: 'fixture-salt' };
export async function loadClient(): Promise<typeof import('../../apps/api/src/subsonic/client.js')> {
  const path = resolve('apps/api/src/subsonic/client.ts');
  expect(existsSync(path), 'typed Subsonic adapter must exist').toBe(true);
  return import(path);
}
export async function loadProtocol(): Promise<typeof import('../../apps/api/src/subsonic/protocol.js')> {
  const path = resolve('apps/api/src/subsonic/protocol.ts');
  expect(existsSync(path), 'Subsonic protocol boundary must exist').toBe(true);
  return import(path);
}
export async function createTestContext(scenario: Scenario = {}, overrides: Partial<ClientOptions> = {}) {
  const module = await loadClient();
  const path = resolve('packages/test-support/src/fake-subsonic.ts');
  expect(existsSync(path), 'read-only loopback fixture server must exist').toBe(true);
  const { createFakeSubsonic }: typeof import('../../packages/test-support/src/fake-subsonic.js') = await import(path);
  const upstream = await createFakeSubsonic(scenario);
  try {
    const client = module.createSubsonicClient({ upstream: upstream.url, proof, timeoutMs: 1000, ...overrides });
    return { client, upstream };
  } catch (error) { await upstream.close(); throw error; }
}
export const ok = (payload: Record<string, unknown> = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.15.0', ...payload } });
export const failed = subsonicErrorFixture;
