import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeSUT(options: { owner?: boolean; directory?: boolean } = {}) {
  const module = await import('../src/imports/external-watch-runtime.js').catch(() => ({}));
  expect(module).toHaveProperty('createExternalWatchRuntime');
  if (!('createExternalWatchRuntime' in module)) return undefined;
  const c = await createTestContext();
  cleanups.push(c.cleanup);
  let now = 1_000;
  const musicPath = join(c.root, 'music');
  mkdirSync(musicPath);
  const musicRoot = realpathSync(musicPath);
  if (options.directory !== false) mkdirSync(join(musicRoot, 'user', 'alice'), { recursive: true });
  const repository = createExternalWatchRepository({ database: c.db, clock: () => now });
  if (options.owner !== false)
    repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 2,
      owners: [
        {
          libraryId: 'library',
          accountDirectory: 'alice',
          username: 'alice',
          identityKey: 'a'.repeat(64),
        },
      ],
    });
  const inventory: Array<{ libraryId: string; accountDirectory: string }> = [];
  const admission: string[] = [];
  const registration: string[] = [];
  const watchers: Array<{
    path: string;
    listener: () => void;
    error: (() => void) | undefined;
    closed: boolean;
  }> = [];
  const logs: Array<Record<string, string | number>> = [];
  const runtime = module.createExternalWatchRuntime({
    database: c.db,
    musicRoot,
    ffprobe: '/synthetic/ffprobe',
    scanClient: {
      getScanStatus: async () => ({ scanning: false, count: 0 }),
      startScan: async () => {},
      indexes: async () => ({ index: [] }),
      registrationDirectory: async (id: string) => ({ id, child: [] }),
    },
    libraries: [
      {
        id: 'library',
        musicFolderId: '0',
        relativeRoot: 'user',
        allowedUsers: ['alice'],
        watchExternalMp3: true,
      },
    ],
    clock: () => now,
    logger: (event: Record<string, string | number>) => logs.push(event),
    testing: {
      inventory: {
        reconcile(target: { libraryId: string; accountDirectory: string }) {
          inventory.push(target);
          if (!existsSync(join(musicRoot, 'user', target.accountDirectory))) {
            repository.ensureRoot({
              libraryId: target.libraryId,
              accountDirectory: target.accountDirectory,
              identityKey: 'a'.repeat(64),
            });
            repository.failRootScan({
              libraryId: target.libraryId,
              accountDirectory: target.accountDirectory,
              failureCode: 'root_unavailable',
              nextReconcileAt: now + 30_000,
            });
            return {
              status: 'blocked' as const,
              processed: 0,
              failureCode: 'root_unavailable',
            };
          }
          return { status: 'complete' as const, processed: 0 };
        },
      },
      createAdmission: () => ({
        async runOnce() {
          admission.push('run');
          return 'idle' as const;
        },
      }),
      registration: {
        async runOnce() {
          registration.push('run');
          return true;
        },
      },
      watch(path: string, listener: () => void) {
        const watcher = {
          path,
          listener,
          closed: false,
          error: undefined as (() => void) | undefined,
          on(_event: 'error', callback: () => void) {
            watcher.error = callback;
            return watcher;
          },
          close() {
            watcher.closed = true;
          },
        };
        watchers.push(watcher);
        return watcher;
      },
    },
  });
  return {
    c,
    runtime,
    inventory,
    admission,
    registration,
    watchers,
    logs,
    musicRoot,
    advance(ms: number) {
      now += ms;
      c.setNow(now);
    },
  };
}

describe('external watch runtime scheduling', () => {
  it('should coalesce watch hints, refresh watchers and reconcile at the safety boundary', async () => {
    const s = await makeSUT();
    if (!s) return;
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.inventory).toHaveLength(1);
    expect(s.watchers).toHaveLength(1);
    s.watchers[0]!.listener();
    s.watchers[0]!.listener();
    s.advance(249);
    expect(await s.runtime.runOnce()).toBe(false);
    s.advance(1);
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.inventory).toHaveLength(2);
    s.advance(59_999);
    expect(await s.runtime.runOnce()).toBe(false);
    s.advance(1);
    expect(await s.runtime.runOnce()).toBe(false);
    expect(s.inventory).toHaveLength(2);
    s.advance(21_540_000);
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.inventory).toHaveLength(3);
    await s.runtime.close();
    expect(s.watchers[0]!.closed).toBe(true);
  });

  it('should recover a late-created directory without relying on an fs event', async () => {
    const s = await makeSUT({ directory: false });
    if (!s) return;
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.watchers).toHaveLength(0);
    mkdirSync(join(s.musicRoot, 'user', 'alice'), { recursive: true });
    s.advance(30_000);
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.inventory).toHaveLength(2);
    expect(s.watchers).toHaveLength(0);
    s.advance(30_000);
    expect(await s.runtime.runOnce()).toBe(false);
    expect(s.watchers).toHaveLength(1);
    expect(s.inventory).toHaveLength(2);
  });

  it('should fall back to periodic reconciliation after watcher failure', async () => {
    const s = await makeSUT();
    if (!s) return;
    await s.runtime.runOnce();
    s.watchers[0]!.error!();
    expect(s.watchers[0]!.closed).toBe(true);
    s.advance(250);
    expect(await s.runtime.runOnce()).toBe(true);
    expect(s.inventory).toHaveLength(2);
    expect(s.logs).toContainEqual({
      event: 'external_watch_listener',
      failureCode: 'watch_unavailable',
    });
    expect(JSON.stringify(s.logs)).not.toContain(s.watchers[0]!.path);
  });

  it('should retry a projection mismatch without touching private targets', async () => {
    const s = await makeSUT({ owner: false });
    if (!s) return;
    expect(await s.runtime.runOnce()).toBe(false);
    expect(s.inventory).toEqual([]);
    expect(s.watchers).toEqual([]);
    expect(s.logs).toContainEqual({
      event: 'external_watch_config',
      failureCode: 'config_mismatch',
    });
    expect(JSON.stringify(s.logs)).not.toMatch(/alice|user|music/);
  });

  it('should schedule settling and registration at five-second boundaries without spinning', async () => {
    const s = await makeSUT();
    if (!s) return;
    await s.runtime.runOnce();
    expect(await s.runtime.runOnce()).toBe(false);
    expect(s.admission).toHaveLength(1);
    expect(s.registration).toHaveLength(0);
    for (let index = 0; index < 20; index += 1) expect(await s.runtime.runOnce()).toBe(false);
    expect(s.admission).toHaveLength(1);
    s.advance(5_000);
    expect(await s.runtime.runOnce()).toBe(false);
    expect(s.admission).toHaveLength(2);
  });

  it('should stop claiming work after abort or close', async () => {
    const s = await makeSUT();
    if (!s) return;
    const abort = new AbortController();
    abort.abort();
    expect(await s.runtime.runOnce(abort.signal)).toBe(false);
    expect(s.inventory).toEqual([]);
    await s.runtime.close();
    expect(await s.runtime.runOnce()).toBe(false);
  });
});
