import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/** API startup reads policy without receiving the privileged worker credential. */
it('should start enabled API with policy alone and preserve readiness when worker is absent', async () => {
  const ctx = await createTestContext();
  const policyPath = join(ctx.storage.data, 'policy.json');
  writeFileSync(
    policyPath,
    JSON.stringify({ schemaVersion: 1, libraries: [], engineManagers: [] }),
  );
  let app;
  try {
    app = createConfiguredApp({
      PUBLIC_ORIGIN: origin,
      GONIC_UPSTREAM: ctx.options.upstream,
      MANAGEMENT_DIRECTORY: ctx.storage.data,
      CREDENTIAL_KEY_PATH: ctx.storage.keyPath,
      SESSION_MAX_AGE_SECONDS: '60',
      IMPORTS_ENABLED: 'true',
      IMPORT_POLICY_PATH: policyPath,
    });
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  } finally {
    await app?.close();
    await ctx.cleanup();
  }
});
/** CLI health is read-only, reports stale state, and never prints private input. */
it('should expose separate worker config and heartbeat probes', async () => {
  const path = resolve('apps/api/src/worker-runtime.ts');
  expect(existsSync(path), 'worker runtime must exist').toBe(true);
  const runtime: {
    workerHealth: (env: Record<string, string | undefined>, now?: number) => boolean;
    readWorkerConfig: (env: Record<string, string | undefined>) => { enabled: boolean };
  } = await import(path);
  expect(runtime.readWorkerConfig({})).toEqual({ enabled: false });
  expect(runtime.workerHealth({})).toBe(false);
  expect(() =>
    runtime.readWorkerConfig({
      IMPORTS_ENABLED: 'true',
      IMPORT_CREDENTIAL_PATH: '/missing-private',
    }),
  ).toThrow(/^invalid_worker_config$/);
  const ctx = await createTestContext();
  try {
    const env = { IMPORTS_ENABLED: 'true', MANAGEMENT_DIRECTORY: realpathSync(ctx.storage.data) };
    expect(runtime.workerHealth(env, 1000)).toBe(false);
    ctx.storage.db.connection
      .prepare(
        "UPDATE worker_state SET worker_id='fixture',status='idle',heartbeat_at=1000 WHERE singleton=1",
      )
      .run();
    expect(runtime.workerHealth(env, 1001)).toBe(true);
    expect(runtime.workerHealth(env, 61_001)).toBe(false);
    expect(runtime.workerHealth(env, 999)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

/** Private config accepts readable owned mounts, rejects broad credentials, and starts/stops the real loop. */
it('should probe private mounts and recover the worker engine across process lifetimes', async () => {
  const { readWorkerConfig, runWorker, workerHealth } = await import('../src/worker-runtime.js');
  const { chmodSync } = await import('node:fs');
  const { createEngineProcessFixture } =
    await import('../../../tests/support/engine-process-fixture.js');
  const ctx = await createTestContext();
  const root = realpathSync(ctx.storage.data);
  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'musiclatte-worker-runtime-')));
  const fixture = createEngineProcessFixture(fixtureRoot, 'no-update');
  const env: Record<string, string> = {
    IMPORTS_ENABLED: 'true',
    MANAGEMENT_DIRECTORY: root,
    GONIC_UPSTREAM: ctx.options.upstream,
    IMPORT_POLICY_PATH: join(fixtureRoot, 'policy.json'),
    IMPORT_CREDENTIAL_PATH: join(fixtureRoot, 'credential.json'),
    IMPORT_MUSIC_ROOT: join(fixtureRoot, 'music'),
    IMPORT_STAGING_ROOT: join(fixtureRoot, 'staging'),
    IMPORT_ENGINE_ROOT: join(fixtureRoot, 'engine'),
    IMPORT_SEED_PATH: fixture.seed.executable,
    IMPORT_SEED_VERSION: fixture.seed.version,
    IMPORT_SEED_SHA256: fixture.seed.hash,
    IMPORT_FFMPEG_PATH: fixture.ffmpeg,
    IMPORT_FFPROBE_PATH: fixture.ffmpeg,
  };
  for (const name of ['music', 'staging', 'engine'])
    mkdirSync(join(fixtureRoot, name), { mode: 0o700 });
  writeFileSync(
    env.IMPORT_POLICY_PATH!,
    JSON.stringify({ schemaVersion: 1, libraries: [], engineManagers: [] }),
  );
  writeFileSync(
    env.IMPORT_CREDENTIAL_PATH!,
    JSON.stringify({ username: 'worker', password: 'synthetic-secret' }),
    { mode: 0o600 },
  );
  try {
    expect(readWorkerConfig(env).enabled).toBe(true);
    chmodSync(env.IMPORT_CREDENTIAL_PATH!, 0o644);
    expect(() => readWorkerConfig(env)).toThrow(/^invalid_worker_config$/);
    chmodSync(env.IMPORT_CREDENTIAL_PATH!, 0o600);
    chmodSync(env.IMPORT_ENGINE_ROOT!, 0o755);
    expect(() => readWorkerConfig(env)).toThrow(/^invalid_worker_config$/);
    chmodSync(env.IMPORT_ENGINE_ROOT!, 0o700);
    expect(() => readWorkerConfig({ ...env, IMPORT_STAGING_ROOT: env.IMPORT_MUSIC_ROOT })).toThrow(
      /^invalid_worker_config$/,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const abort = new AbortController();
      const running = runWorker(env, abort.signal);
      try {
        await expect.poll(() => workerHealth(env)).toBe(true);
        await expect.poll(() => ctx.storage.engines.get().lastCheckedAt).not.toBeNull();
      } finally {
        abort.abort();
        await running;
      }
      expect(workerHealth(env)).toBe(false);
      expect(ctx.storage.engines.get().activeVersion).toBe(fixture.seed.version);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    await ctx.cleanup();
  }
});

/** Disabled worker startup does not need files that belong only to the opt-in overlay. */
it('should run the disabled CLI probe without inspecting a missing seed manifest', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/worker-entry.ts', '--check-config'],
    {
      env: {
        ...process.env,
        IMPORTS_ENABLED: 'false',
        IMPORT_SEED_MANIFEST: '/missing-synthetic-manifest',
      },
      encoding: 'utf8',
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('worker_disabled\n');
  expect(result.stderr).toBe('');
});
