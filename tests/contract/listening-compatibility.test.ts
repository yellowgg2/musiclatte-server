import { decodePreListeningCapabilities } from '../../packages/test-support/src/listening-fixtures.js';
import { afterEach, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../support/auth-harness.js';
import { decodeCapabilities } from '../../packages/contracts/src/capabilities.js';
const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.cleanup();
});
/** Optional listening keys remain false and capability discovery never submits or streams music. */
it('should preserve old consumers with default-off listening capabilities', async () => {
  const ctx = await createTestContext();
  contexts.push(ctx);
  const login = await ctx.login();
  const response = await ctx.app.inject({
    url: '/api/v1/capabilities',
    headers: { cookie: cookieOf(login) },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  for (const key of ['mixes.saved', 'listening.history', 'music.streamQuality', 'music.artistInfo'])
    expect(body.features[key]).toEqual({
      supported: false,
      permission: 'denied',
      availability: 'available',
    });
  expect(decodeCapabilities(body).features['music.browse']?.supported).toBe(true);
  expect(decodePreListeningCapabilities(body).features).not.toHaveProperty('mixes.saved');
  expect(decodePreListeningCapabilities(body).features['music.stream']?.supported).toBe(true);
  const oldShape = { ...body, features: { 'music.browse': body.features['music.browse'] } };
  expect(decodeCapabilities(oldShape).features).toEqual(oldShape.features);
  expect(ctx.requests.map((url) => url.pathname)).not.toContain('/rest/scrobble');
  expect(ctx.requests.map((url) => url.pathname)).not.toContain('/rest/startScan');
  expect(ctx.requests.map((url) => url.pathname)).not.toContain('/rest/stream');
});
