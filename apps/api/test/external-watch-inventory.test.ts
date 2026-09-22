import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

async function makeSUT(
  options: {
    maxEntries?: number;
    maxStagedEntries?: number;
    maxElapsedMs?: number;
    budgetClock?: () => number;
    readDirectory?: (path: string) => Dirent[];
  } = {},
) {
  const module = await import('../src/imports/external-watch-inventory.js').catch(() => ({}));
  expect(module).toHaveProperty('createExternalWatchInventory');
  if (!('createExternalWatchInventory' in module)) return undefined;
  ctx ??= await createTestContext();
  const musicRoot = join(ctx.root, 'music');
  mkdirSync(musicRoot, { recursive: true });
  const repository = createExternalWatchRepository({ database: ctx.db, clock: () => now });
  repository.syncOwners({
    instanceId: 'instance-1',
    policyRevision: 1,
    owners: [
      {
        libraryId: 'music',
        accountDirectory: 'alice',
        username: 'alice',
        identityKey: 'a'.repeat(64),
      },
    ],
  });
  return {
    musicRoot,
    repository,
    inventory: module.createExternalWatchInventory({
      database: ctx.db,
      musicRoot,
      clock: () => now,
      ...options,
    }),
  };
}

let now = 0;
const target = {
  libraryId: 'music',
  relativeRoot: 'jojo-music',
  accountDirectory: 'alice',
  identityKey: 'a'.repeat(64),
};

function finish(inventory: {
  reconcile: (input: typeof target) => { status: string; processed: number };
}) {
  let result = inventory.reconcile(target);
  for (let attempt = 0; result.status === 'progress' && attempt < 1000; attempt += 1)
    result = inventory.reconcile(target);
  expect(result.status).toBe('complete');
  return result;
}

describe('external watch inventory', () => {
  it('should preserve 64-bit root identities beyond the JavaScript safe integer range', async () => {
    const module = await import('../src/imports/external-watch-inventory.js').catch(() => ({}));
    const identify = (module as Record<string, unknown>).externalWatchRootIdentity;
    expect(identify).toBeTypeOf('function');
    if (typeof identify !== 'function') return;

    const identity = (
      identify as (stat: { dev: bigint; ino: bigint }) => { device: string; inode: string }
    )({ dev: 10n, ino: 9_007_199_254_740_993n });
    expect(identity).toEqual({ device: '10', inode: '9007199254740993' });

    const c = await makeSUT();
    if (!c) return;
    c.repository.ensureRoot({
      libraryId: target.libraryId,
      accountDirectory: target.accountDirectory,
      identityKey: target.identityKey,
    });
    c.repository.startRootScan({
      libraryId: target.libraryId,
      accountDirectory: target.accountDirectory,
      identityKey: target.identityKey,
      rootDevice: identity.device,
      rootInode: identity.inode,
      continuation: { version: 1, directories: [{ key: '', offset: 0 }] },
    });
    expect(c.repository.getRoot(target.libraryId, target.accountDirectory)).toMatchObject({
      rootDevice: '10',
      rootInode: '9007199254740993',
    });
    expect(() =>
      (identify as (stat: { dev: bigint; ino: bigint }) => unknown)({
        dev: 10n,
        ino: 9_223_372_036_854_775_808n,
      }),
    ).toThrow('root_unavailable');
  });

  it('should baseline only exact account MP3 files and settle later nested additions', async () => {
    now = 10;
    const c = await makeSUT({ maxEntries: 3 });
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    const sibling = join(c.musicRoot, 'jojo-music', 'public');
    const outside = join(c.musicRoot, 'outside');
    mkdirSync(join(account, '기존', '깊은 곳'), { recursive: true });
    mkdirSync(sibling, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(account, '기존.mp3'), 'old');
    writeFileSync(join(account, '기존', '깊은 곳', '대문자.MP3'), 'old');
    writeFileSync(join(account, 'ignore.flac'), 'not mp3');
    writeFileSync(join(sibling, 'private.mp3'), 'sibling');
    writeFileSync(join(outside, 'escape.mp3'), 'outside');
    symlinkSync(join(outside, 'escape.mp3'), join(account, 'linked.mp3'));
    symlinkSync(outside, join(account, 'linked-directory'));

    finish(c.inventory);
    expect(c.repository.listObservations('music')).toMatchObject([
      { relativeFileKey: 'jojo-music/alice/기존.mp3', state: 'baseline' },
      { relativeFileKey: 'jojo-music/alice/기존/깊은 곳/대문자.MP3', state: 'baseline' },
    ]);
    expect(
      ctx!.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({ count: 0 });
    expect(c.repository.getRoot('music', 'alice')).toMatchObject({
      state: 'active',
      continuation: null,
    });

    now = 20;
    mkdirSync(join(account, '새 폴더'));
    writeFileSync(join(account, '새 폴더', '신규.mp3'), 'new');
    finish(c.inventory);
    expect(c.repository.getObservation('music', 'jojo-music/alice/새 폴더/신규.mp3')).toMatchObject(
      {
        state: 'settling',
        firstSeenAt: 20,
        stableSinceAt: 20,
      },
    );
    expect(c.repository.listObservations('music')).toHaveLength(3);
  });

  it('should persist an entry-bounded continuation and resume it after recreation', async () => {
    now = 100;
    const c = await makeSUT({ maxEntries: 7 });
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    for (let index = 0; index < 40; index += 1)
      writeFileSync(join(account, `track-${String(index).padStart(2, '0')}.mp3`), 'fixture');

    const first = c.inventory.reconcile(target);
    expect(first).toMatchObject({ status: 'progress', processed: 7 });
    const persisted = c.repository.getRoot('music', 'alice');
    expect(persisted).toMatchObject({
      state: 'baselining',
      continuation: expect.objectContaining({ version: 1 }),
    });
    expect(JSON.stringify(persisted?.continuation)).not.toContain(c.musicRoot);

    const recreated = await makeSUT({ maxEntries: 7 });
    if (!recreated) return;
    finish(recreated.inventory);
    expect(recreated.repository.listObservations('music')).toHaveLength(40);
    expect(recreated.repository.getRoot('music', 'alice')).toMatchObject({
      state: 'active',
      continuation: null,
    });
  });

  /** A completed no-change scan performs only root-level writes, independent of file count. */
  it('should commit an unchanged full scan without observation writes', async () => {
    now = 100;
    const c = await makeSUT();
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    for (let index = 0; index < 40; index += 1)
      writeFileSync(join(account, `unchanged-${String(index).padStart(2, '0')}.mp3`), 'fixture');
    finish(c.inventory);
    const beforeRows = c.repository.listObservations('music');
    const beforeChanges = ctx!.db.connection.prepare('SELECT total_changes() AS count').get()
      ?.count as number;

    now = 200;
    finish(c.inventory);

    const afterChanges = ctx!.db.connection.prepare('SELECT total_changes() AS count').get()
      ?.count as number;
    expect(afterChanges - beforeChanges).toBeLessThanOrEqual(3);
    expect(c.repository.listObservations('music')).toEqual(beforeRows);
    expect(c.repository.getRoot('music', 'alice')?.scanCompletedAt).toBe(200);
  });

  /** Capacity failure discards the staged scan without changing durable observations. */
  it('should block an oversized staged snapshot without partial observation writes', async () => {
    now = 100;
    const c = await makeSUT({ maxStagedEntries: 2 });
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    for (let index = 0; index < 3; index += 1)
      writeFileSync(join(account, `capacity-${index}.mp3`), 'fixture');

    expect(c.inventory.reconcile(target)).toMatchObject({
      status: 'blocked',
      failureCode: 'inventory_capacity',
    });
    expect(c.repository.listObservations('music')).toEqual([]);
    expect(c.repository.getRoot('music', 'alice')).toMatchObject({
      state: 'blocked',
      scanCompletedAt: null,
    });
  });

  it('should reset changed candidates, mark disappearance, and never promote baseline paths', async () => {
    now = 0;
    const c = await makeSUT();
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    const legacy = join(account, 'legacy.mp3');
    writeFileSync(legacy, 'legacy');
    finish(c.inventory);
    c.repository.observe({
      libraryId: 'music',
      relativeFileKey: 'jojo-music/alice/rejected.mp3',
      accountDirectory: 'alice',
      identityKey: 'a'.repeat(64),
      state: 'rejected',
      fingerprint: { device: 1, inode: 1, size: 1, mtimeNs: '1', ctimeNs: '1', linkCount: 1 },
      nextAttemptAt: 0,
    });
    writeFileSync(join(account, 'rejected.mp3'), 'replacement must stay rejected');

    now = 10;
    const candidate = join(account, 'candidate.mp3');
    writeFileSync(candidate, 'one');
    finish(c.inventory);
    const first = c.repository.getObservation('music', 'jojo-music/alice/candidate.mp3');
    expect(first).toMatchObject({ state: 'settling', stableSinceAt: 10 });

    now = 20;
    writeFileSync(candidate, 'changed-and-longer');
    finish(c.inventory);
    const changed = c.repository.getObservation('music', 'jojo-music/alice/candidate.mp3');
    expect(changed).toMatchObject({ state: 'settling', stableSinceAt: 20, attempt: 0 });
    expect(changed?.fingerprint).not.toEqual(first?.fingerprint);
    writeFileSync(legacy, 'changed legacy content');
    finish(c.inventory);
    expect(c.repository.getObservation('music', 'jojo-music/alice/legacy.mp3')?.state).toBe(
      'baseline',
    );
    expect(c.repository.getObservation('music', 'jojo-music/alice/rejected.mp3')?.state).toBe(
      'rejected',
    );

    now = 30;
    rmSync(candidate);
    finish(c.inventory);
    expect(c.repository.getObservation('music', 'jojo-music/alice/candidate.mp3')?.state).toBe(
      'absent',
    );

    now = 40;
    writeFileSync(candidate, 'returned');
    finish(c.inventory);
    expect(c.repository.getObservation('music', 'jojo-music/alice/candidate.mp3')).toMatchObject({
      state: 'settling',
      stableSinceAt: 40,
    });
    rmSync(candidate);
    finish(c.inventory);
    expect(c.repository.getObservation('music', 'jojo-music/alice/candidate.mp3')?.state).toBe(
      'absent',
    );
  });

  it('should fail closed for missing, unreadable, or replaced account roots', async () => {
    now = 0;
    const c = await makeSUT();
    if (!c) return;
    expect(c.inventory.reconcile(target)).toMatchObject({
      status: 'blocked',
      failureCode: 'root_unavailable',
    });

    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    writeFileSync(join(account, 'baseline.mp3'), 'old');
    const normal = await makeSUT();
    if (!normal) return;
    finish(normal.inventory);

    mkdirSync(join(account, 'locked'));
    const guarded = await makeSUT({
      readDirectory: (path) => {
        if (path.endsWith('/locked'))
          throw Object.assign(new Error('private path'), { code: 'EACCES' });
        return readdirSync(path, { withFileTypes: true });
      },
    });
    if (!guarded) return;
    expect(guarded.inventory.reconcile(target)).toMatchObject({
      status: 'blocked',
      failureCode: 'entry_unreadable',
    });
    finish(normal.inventory);

    renameSync(account, `${account}-old`);
    mkdirSync(account);
    writeFileSync(join(account, 'replacement.mp3'), 'replacement');
    expect(normal.inventory.reconcile(target)).toMatchObject({
      status: 'blocked',
      failureCode: 'root_replaced',
    });
    expect(
      normal.repository.getObservation('music', 'jojo-music/alice/replacement.mp3'),
    ).toBeNull();
  });

  it('should yield on the elapsed-time budget before consuming the entry budget', async () => {
    now = 0;
    let elapsed = 0;
    const c = await makeSUT({
      maxEntries: 256,
      maxElapsedMs: 3,
      budgetClock: () => elapsed++,
    });
    if (!c) return;
    const account = join(c.musicRoot, 'jojo-music', 'alice');
    mkdirSync(account, { recursive: true });
    for (let index = 0; index < 10; index += 1)
      writeFileSync(join(account, `timed-${index}.mp3`), 'fixture');
    const first = c.inventory.reconcile(target);
    expect(first.status).toBe('progress');
    expect(first.processed).toBeLessThan(10);
  });
});
