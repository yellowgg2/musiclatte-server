import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
interface ApiModule {
  createApp: () => FastifyInstance;
  readConfig: (env: Record<string, string | undefined>) => {
    host: string;
    port: number;
    nodeEnv: string;
  };
}
async function makeSUT(): Promise<ApiModule> {
  const path = resolve('apps/api/src/app.ts');
  expect(existsSync(path), 'API module must exist').toBe(true);
  return import(path);
}
describe('API runtime', () => {
  /** Liveness completes independently from any upstream service. */
  it('should serve liveness and keep unknown API routes as 404', async () => {
    const { createApp } = await makeSUT();
    const app = createApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(response.headers['content-type']).toContain('application/json');
      expect((await app.inject('/api/v1/missing')).statusCode).toBe(404);
      expect((await app.inject('/rest/ping')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  /** Development binds to loopback, with explicit deployment overrides. */
  it('should validate default and explicit server settings', async () => {
    const { readConfig } = await makeSUT();
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 3000, nodeEnv: 'development' });
    expect(readConfig({ HOST: '0.0.0.0', PORT: '65535', NODE_ENV: 'production' })).toEqual({
      host: '0.0.0.0',
      port: 65535,
      nodeEnv: 'production',
    });
  });
  /** Invalid configuration fails before listening without echoing supplied values. */
  it('should reject malformed ports hosts and runtime modes', async () => {
    const { readConfig } = await makeSUT();
    for (const port of ['', '0', '-1', '65536', '3000x', '1.5', ' 3000', '1e3'])
      expect(() => readConfig({ PORT: port })).toThrow('Invalid PORT');
    expect(() => readConfig({ HOST: '' })).toThrow('Invalid HOST');
    expect(() => readConfig({ HOST: 'https://example.com' })).toThrow('Invalid HOST');
    expect(() => readConfig({ NODE_ENV: 'secret-value' })).toThrow('Invalid NODE_ENV');
  });
});
