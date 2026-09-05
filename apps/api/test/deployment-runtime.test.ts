import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfiguredApp } from '../src/auth/runtime.js';
import { createTestContext, origin } from '../../../tests/support/auth-harness.js';
interface Bootstrap {
  initializeContainerStorage: (directory: string, keyPath: string) => void;
}
async function bootstrap(): Promise<Bootstrap> {
  const path = resolve('apps/api/src/config/runtime.ts');
  expect(existsSync(path), 'container storage initializer must exist').toBe(true);
  return import(path);
}
describe('container lifecycle', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function makeSUT() {
    const root = mkdtempSync(join(tmpdir(), 'musiclatte-container-'));
    roots.push(root);
    const directory = join(root, 'data');
    mkdirSync(directory);
    return { directory, keyPath: join(root, 'keys', 'credential.key') };
  }
  /** Fresh volumes receive exactly one private key and restarts preserve it. */
  it('should initialize only empty storage and preserve its key on restart', async () => {
    const { initializeContainerStorage } = await bootstrap();
    const ctx = makeSUT();
    initializeContainerStorage(ctx.directory, ctx.keyPath);
    const key = readFileSync(ctx.keyPath);
    expect(key.length).toBe(32);
    initializeContainerStorage(ctx.directory, ctx.keyPath);
    expect(readFileSync(ctx.keyPath)).toEqual(key);
  });
  /** Losing keys must never silently make existing encrypted sessions unrecoverable. */
  it('should fail closed for nonempty storage with a missing or invalid key', async () => {
    const { initializeContainerStorage } = await bootstrap();
    const ctx = makeSUT();
    writeFileSync(join(ctx.directory, 'management.sqlite'), 'existing');
    expect(() => initializeContainerStorage(ctx.directory, ctx.keyPath)).toThrow(
      'Container storage initialization failed',
    );
    expect(existsSync(ctx.keyPath)).toBe(false);
    mkdirSync(join(ctx.keyPath, '..'), { recursive: true });
    writeFileSync(ctx.keyPath, 'invalid');
    expect(() => initializeContainerStorage(ctx.directory, ctx.keyPath)).toThrow(
      'Container storage initialization failed',
    );
  });
  /** Readiness follows actual upstream connectivity while liveness and discovery remain available. */
  it('should report bounded upstream readiness and recover without restarting', async () => {
    const ctx = await createTestContext();
    const app = createConfiguredApp({
      PUBLIC_ORIGIN: origin,
      GONIC_UPSTREAM: ctx.options.upstream,
      MANAGEMENT_DIRECTORY: ctx.storage.data,
      CREDENTIAL_KEY_PATH: ctx.storage.keyPath,
      SESSION_MAX_AGE_SECONDS: '60',
      NODE_ENV: 'production',
      SUBSONIC_TIMEOUT_MS: '100',
    });
    try {
      expect((await app.inject('/health/ready')).statusCode).toBe(200);
      ctx.state.status = 503;
      const failed = await app.inject('/health/ready');
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({ status: 'unavailable' });
      expect(failed.body).not.toContain('synthetic-secret');
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      expect((await app.inject('/.well-known/musiclatte-server')).statusCode).toBe(200);
      ctx.state.status = 200;
      ctx.state.stall = true;
      expect((await app.inject('/health/ready')).statusCode).toBe(503);
      ctx.state.stall = false;
      expect((await app.inject('/health/ready')).statusCode).toBe(200);
      expect(
        ctx.requests.every((url) => !url.searchParams.has('t') && !url.searchParams.has('p')),
      ).toBe(true);
    } finally {
      await app.close();
      await ctx.cleanup();
    }
  });
});
