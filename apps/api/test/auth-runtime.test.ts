import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, origin } from '../../../tests/support/auth-harness.js';
interface RuntimeModule { createConfiguredApp: (env: Record<string, string | undefined>) => FastifyInstance }
async function runtime(): Promise<RuntimeModule> { const path = resolve('apps/api/src/auth/runtime.ts'); expect(existsSync(path), 'configured HTTP runtime must exist').toBe(true); return import(path); }
describe('configured authentication runtime', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = []; const apps: FastifyInstance[] = [];
  async function makeSUT() { const ctx = await createTestContext(); contexts.push(ctx); const env = { PUBLIC_ORIGIN: origin, GONIC_UPSTREAM: ctx.options.upstream, MANAGEMENT_DIRECTORY: ctx.storage.data, CREDENTIAL_KEY_PATH: ctx.storage.keyPath, SESSION_MAX_AGE_SECONDS: '60', NODE_ENV: 'production' }; return { ctx, env }; }
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const ctx of contexts.splice(0)) await ctx.cleanup(); });
  /** The real runtime loads matching persistent storage/key and serves the auth API after restart. */
  it('should assemble persistent authentication in the listening runtime', async () => {
    const { ctx, env } = await makeSUT(); const module = await runtime(); const first = module.createConfiguredApp(env); apps.push(first);
    const login = await first.inject({ method: 'POST', url: '/api/v1/session', headers: { origin, 'x-musiclatte-client': 'web' }, payload: { kind: 'password', username: 'fixture-listener', password: 'synthetic-password' } });
    expect(login.statusCode).toBe(201); expect(login.headers['set-cookie']).toContain('Secure');
    const cookie = String(login.headers['set-cookie']).split(';')[0]!; await first.close(); apps.splice(apps.indexOf(first), 1);
    const next = module.createConfiguredApp(env); apps.push(next);
    expect((await next.inject({ url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(200);
    expect((await next.inject('/.well-known/musiclatte-server')).json().instanceId).toBe(ctx.storage.instances.get().id);
  });
  /** Missing and unsafe deployment values fail closed without echoing configuration. */
  it.each(['PUBLIC_ORIGIN', 'GONIC_UPSTREAM', 'MANAGEMENT_DIRECTORY', 'CREDENTIAL_KEY_PATH', 'SESSION_MAX_AGE_SECONDS'])('should require %s', async key => {
    const { env } = await makeSUT(); const module = await runtime(); expect(() => module.createConfiguredApp({ ...env, [key]: undefined })).toThrow();
  });
  /** Production uses TLS cookies and only explicit booleans may enable management writes. */
  it.each([{ PUBLIC_ORIGIN: 'http://music.example.test' }, { PUBLIC_ORIGIN: 'https://music.example.test/path' }, { GONIC_UPSTREAM: 'https://user:secret@evil.test' }, { ALLOW_SCAN: 'yes' }, { SUBSONIC_TIMEOUT_MS: '0' }, { SESSION_MAX_AGE_SECONDS: '0' }, { CREDENTIAL_KEY_PATH: '/missing/secret-key' }])('should reject unsafe configuration %#', async override => {
    const { env } = await makeSUT(); const module = await runtime(); expect(() => module.createConfiguredApp({ ...env, ...override })).toThrow('Invalid authentication configuration');
  });
});
