import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
interface WebModule { readWebConfig: (env: Record<string, string | undefined>) => { base: string; apiOrigin: string } }
async function makeSUT(): Promise<WebModule> {
  const path = resolve('apps/web/src/config.ts');
  expect(existsSync(path), 'web configuration must exist').toBe(true);
  return import(path);
}
describe('workspace contracts', () => {
  /** SPA asset base and API origin remain independently configurable. */
  it('should keep root and nested SPA base separate from API origin', async () => {
    const { readWebConfig } = await makeSUT();
    expect(readWebConfig({})).toEqual({ base: '/', apiOrigin: '' });
    expect(readWebConfig({ VITE_APP_BASE: '/music/', VITE_API_ORIGIN: 'https://api.example.com' })).toEqual({ base: '/music/', apiOrigin: 'https://api.example.com' });
  });
  /** Reject credentials, paths and non-HTTP origins before they enter a browser build. */
  it('should reject invalid browser configuration', async () => {
    const { readWebConfig } = await makeSUT();
    for (const base of ['', 'music', '//evil/', '/music', '/a?x/', '/a#x/', '/a/../', '/a\\b/']) expect(() => readWebConfig({ VITE_APP_BASE: base })).toThrow('Invalid VITE_APP_BASE');
    for (const origin of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?q=x', 'https://example.com#x']) expect(() => readWebConfig({ VITE_API_ORIGIN: origin })).toThrow('Invalid VITE_API_ORIGIN');
  });
  /** A real HTTP producer matches the shared synthetic health fixture. */
  it('should match the public liveness contract across workspaces', async () => {
    const apiPath = resolve('apps/api/src/app.ts');
    const fixturePath = resolve('packages/test-support/src/index.ts');
    expect(existsSync(apiPath), 'API module must exist').toBe(true);
    expect(existsSync(fixturePath), 'test-support module must exist').toBe(true);
    const api: { createApp: () => FastifyInstance } = await import(apiPath);
    const fixture: { createHealthFixture: () => { status: 'ok' } } = await import(fixturePath);
    const app = api.createApp();
    try {
      const response = await app.inject('/health/live');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(fixture.createHealthFixture());
    } finally { await app.close(); }
  });
});
