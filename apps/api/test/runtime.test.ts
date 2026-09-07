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

/** Imports remain opt-in and malformed enabled configuration fails before opening the application. */
it('should reject enabled imports without policy and worker credentials at startup', async () => {
  const { createConfiguredApp } = await import('../src/auth/runtime.js');
  const { createTestContext, origin } = await import('../../../tests/support/auth-harness.js');
  const ctx = await createTestContext();
  try {
    const env = {
      PUBLIC_ORIGIN: origin,
      GONIC_UPSTREAM: ctx.options.upstream,
      MANAGEMENT_DIRECTORY: ctx.storage.data,
      CREDENTIAL_KEY_PATH: ctx.storage.keyPath,
      SESSION_MAX_AGE_SECONDS: '60',
    };
    for (const IMPORTS_ENABLED of ['true', 'yes', ''])
      expect(() => createConfiguredApp({ ...env, IMPORTS_ENABLED })).toThrow(
        'Invalid authentication configuration',
      );
    const app = createConfiguredApp({ ...env, IMPORTS_ENABLED: 'false' });
    await app.close();
  } finally {
    await ctx.cleanup();
  }
});

/** Config probes validate the enabled policy and credentials without exposing secret values. */
it('should resolve the false true and invalid import config matrix', async () => {
  const path = resolve('apps/api/src/imports/config.ts');
  expect(existsSync(path), 'import configuration boundary must exist').toBe(true);
  const {
    readImportConfig,
  }: {
    readImportConfig: (env: Record<string, string | undefined>) => {
      enabled: boolean;
      policy: { enabled: boolean };
    };
  } = await import(path);
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(resolve(tmpdir(), 'musiclatte-import-config-'));
  try {
    const policyPath = resolve(root, 'policy.json');
    writeFileSync(
      policyPath,
      JSON.stringify({ schemaVersion: 1, libraries: [], engineManagers: [] }),
    );
    expect(readImportConfig({})).toMatchObject({ enabled: false, policy: { enabled: false } });
    expect(
      readImportConfig({ IMPORTS_ENABLED: 'false', IMPORT_POLICY_PATH: '/missing' }).enabled,
    ).toBe(false);
    const valid = {
      IMPORTS_ENABLED: 'true',
      IMPORT_POLICY_PATH: policyPath,
      IMPORT_WORKER_USERNAME: 'worker',
      IMPORT_WORKER_PASSWORD: 'synthetic-worker-secret',
    };
    expect(readImportConfig(valid)).toMatchObject({ enabled: true, policy: { enabled: true } });
    for (const key of ['IMPORT_POLICY_PATH', 'IMPORT_WORKER_USERNAME', 'IMPORT_WORKER_PASSWORD'])
      expect(() => readImportConfig({ ...valid, [key]: undefined })).toThrow(
        /^invalid_import_config$/,
      );
    for (const IMPORTS_ENABLED of ['1', '', 'TRUE'])
      expect(() => readImportConfig({ ...valid, IMPORTS_ENABLED })).toThrow(
        /^invalid_import_config$/,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The configured runtime wires private policy and persisted health into the producer without worker probes. */
it('should serve imports from configured policy and the existing durable database', async () => {
  const { writeFileSync } = await import('node:fs');
  const { createConfiguredApp } = await import('../src/auth/runtime.js');
  const { createTestContext, origin, password, browserHeaders, cookieOf } =
    await import('../../../tests/support/auth-harness.js');
  const { createWorkerStateRepository } = await import('../src/storage/worker-state-repository.js');
  const ctx = await createTestContext();
  let app: FastifyInstance | undefined;
  try {
    const policyPath = resolve(ctx.storage.root, 'import-policy.json');
    writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        libraries: [
          {
            id: 'music',
            musicFolderId: '1',
            relativeRoot: 'imports',
            allowedUsers: [password.username],
          },
        ],
        engineManagers: [],
      }),
    );
    ctx.storage.engines.initialize('fixture-engine');
    createWorkerStateRepository({ database: ctx.storage.db, clock: Date.now }).heartbeat({
      workerId: 'worker',
      status: 'idle',
    });
    app = createConfiguredApp({
      PUBLIC_ORIGIN: origin,
      GONIC_UPSTREAM: ctx.options.upstream,
      MANAGEMENT_DIRECTORY: ctx.storage.data,
      CREDENTIAL_KEY_PATH: ctx.storage.keyPath,
      IMPORTS_ENABLED: 'true',
      IMPORT_POLICY_PATH: policyPath,
      IMPORT_WORKER_USERNAME: 'worker',
      IMPORT_WORKER_PASSWORD: 'synthetic-only',
      SESSION_MAX_AGE_SECONDS: '60',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: browserHeaders,
      payload: password,
    });
    expect(login.statusCode).toBe(201);
    const headers = {
      ...browserHeaders,
      cookie: cookieOf(login),
      'x-csrf-token': login.json().csrfToken,
    };
    const capabilities = await app.inject({ url: '/api/v1/capabilities', headers });
    expect(capabilities.json().features['imports.youtube']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers,
      payload: {
        operationId: 'A'.repeat(22),
        libraryId: 'music',
        urls: ['https://youtu.be/abcdefghijk'],
      },
    });
    expect(response.statusCode).toBe(202);
    expect(
      ctx.storage.db.connection.prepare('SELECT count(*) AS n FROM import_jobs').get()?.n,
    ).toBe(1);
    expect(response.body).not.toMatch(/synthetic-only|relativeRoot|credential/);
  } finally {
    await app?.close();
    await ctx.cleanup();
  }
});
