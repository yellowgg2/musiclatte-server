import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRecentContext, recentNow } from '../../../tests/support/recent-harness.js';
import { cookieOf, password, native } from '../../../tests/support/auth-harness.js';
import { createApp } from '../src/app.js';
import { createConfiguredApp } from '../src/auth/runtime.js';
import { createSessionService } from '../src/auth/session-service.js';
import { loadKey } from '../src/security/key-store.js';

const iso = (value: number) => new Date(value).toISOString();
const week = 7 * 24 * 60 * 60 * 1000;
describe('recent downloads API', () => {
  const cleanups: (() => Promise<void>)[] = [];
  async function makeSUT() {
    const c = await createRecentContext();
    cleanups.push(c.cleanup);
    return c;
  }
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** Default UTC range includes exactly the preceding seven days and never the exclusive end. */
  it('should return a fixed seven-day filter with current ready metadata', async () => {
    const c = await makeSUT();
    c.seed({ at: recentNow - week - 1 });
    c.seed({ at: recentNow - week });
    c.seed({ at: recentNow });
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      filter: { from: iso(recentNow - week), to: iso(recentNow) },
      asOf: iso(recentNow),
      nextCursor: null,
      items: [
        {
          downloadCompletedAt: iso(recentNow - week),
          state: 'ready',
          song: { id: 'song-2', title: 'Synthetic song 2' },
        },
      ],
    });
    expect(response.body).not.toMatch(
      /relativeFileKey|sourceId|synthetic audio|"path"|musiclatte-storage/,
    );
  });

  it('resolves historical download events through the rebound current media link', async () => {
    const c = await makeSUT();
    const seeded = c.seed();
    const managedKey = 'imports/account/ID3-managed/Artist/Album/01 - Rebound.mp3';
    const managedFile = `${c.musicRoot}/${managedKey}`;
    mkdirSync(managedFile.slice(0, managedFile.lastIndexOf('/')), { recursive: true });
    renameSync(seeded.file, managedFile);
    c.storage.db.connection
      .prepare(
        "UPDATE media_links SET relative_file_key=?,gonic_song_id='rebound-song',revision=revision+1 WHERE id='media-1'",
      )
      .run(managedKey);
    Object.assign(seeded.song, {
      id: 'rebound-song',
      title: 'Rebound',
      path: managedKey,
    });
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      state: 'ready',
      song: { id: 'rebound-song', title: 'Rebound' },
    });
    expect(response.body).not.toContain(seeded.fileKey);
  });

  /** Date picker timezone conversion still obeys start-inclusive/end-exclusive instants. */
  it('should honor explicit UTC instants converted from another timezone', async () => {
    const c = await makeSUT();
    const from = new Date('2026-09-06T00:00:00+09:00').toISOString();
    const to = new Date('2026-09-07T00:00:00+09:00').toISOString();
    c.seed({ at: Date.parse(from) - 1 });
    c.seed({ at: Date.parse(from) });
    c.seed({ at: Date.parse(to) });
    const response = await c.get({ from, to });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().filter).toEqual({ from, to });
  });

  /** Unknown, repeated, incomplete and invalid range/limit parameters fail closed. */
  it.each([
    'from=2026-09-01T00:00:00Z',
    'to=2026-09-07T00:00:00Z',
    'from=x&to=y',
    'from=2026-09-07T00:00:00Z&to=2026-09-01T00:00:00Z',
    'from=2026-09-07T00:00:00Z&to=2026-09-07T00:00:00Z',
    'from=2026-02-30T00:00:00Z&to=2026-09-07T00:00:00Z',
    'from=2026-09-01&to=2026-09-07',
    'limit=0',
    'limit=101',
    'limit=01',
    'limit=1&limit=2',
    'cursor=',
    'asOf=x',
    'libraryId=music',
    'from=2026-09-01T00:00:00Z&from=2026-09-01T00:00:00Z&to=2026-09-07T00:00:00Z',
  ])('should reject query %s', async (query) => {
    const c = await makeSUT();
    const response = await c.app.inject({
      url: `/api/v1/recent-downloads?${query}`,
      headers: c.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  /** Same-time ties and post-snapshot backdated inserts cannot shift existing page membership. */
  it('should paginate a stable snapshot across libraries and new inserts', async () => {
    const c = await makeSUT();
    c.seed({ id: 'event-c' });
    c.seed({ id: 'event-b', libraryId: 'second' });
    c.seed({ id: 'event-a' });
    const first = await c.get({ limit: '1' });
    expect(first.statusCode).toBe(200);
    c.seed({ id: 'event-bb' });
    c.seed({ id: 'event-old', at: recentNow - 2000 });
    c.setNow(recentNow + 10_000);
    const second = await c.get({ limit: '1', cursor: first.json().nextCursor });
    expect(second.statusCode).toBe(200);
    const third = await c.get({ limit: '1', cursor: second.json().nextCursor });
    expect(third.statusCode).toBe(200);
    expect([first, second, third].map((r) => r.json().items[0].song.id)).toEqual([
      'song-1',
      'song-2',
      'song-3',
    ]);
    expect(third.json().nextCursor).toBeNull();
    expect(second.json().filter).toEqual(first.json().filter);
    expect(second.json().asOf).toBe(first.json().asOf);
    expect((await c.get()).json().items).toHaveLength(5);
  });

  /** Cursor HMAC binds account, library configuration, filter, asOf and last tuple. */
  it('should reject cursor tampering and cross-account/filter/library replay', async () => {
    const c = await makeSUT();
    c.seed();
    c.seed();
    const first = await c.get({ limit: '1' });
    expect(first.statusCode).toBe(200);
    const cursor = first.json().nextCursor as string;
    expect((await c.get({ cursor: `${cursor}x` })).statusCode).toBe(400);
    expect(
      (await c.get({ cursor, from: iso(recentNow - week + 1), to: iso(recentNow) })).statusCode,
    ).toBe(400);
    const other = await c.login(undefined, { ...password, username: 'other-user' });
    expect((await c.get({ cursor }, { cookie: cookieOf(other) })).statusCode).toBe(400);
    expect((await c.get({}, { cookie: cookieOf(other) })).json().items).toEqual([]);
    c.imports.policy.libraries.pop();
    expect((await c.get({ cursor })).statusCode).toBe(400);
  });

  /** Registering and disappeared songs retain history without selection-bearing song payloads. */
  it('should project registering, deleted file and gonic 70 without deleting history', async () => {
    const c = await makeSUT();
    c.seed({ state: 'registering' });
    const deleted = c.seed();
    rmSync(deleted.file);
    c.seed();
    c.songs.pop();
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { state: string }) => item.state)).toEqual([
      'missing',
      'missing',
      'registering',
    ]);
    expect(response.json().items.every((item: object) => !Object.hasOwn(item, 'song'))).toBe(true);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()?.n,
    ).toBe(3);
    expect(c.requests.filter((url) => url.pathname === '/rest/getSong')).toHaveLength(1);
  });

  /** Nonregular files, symlink components and ID/path aliases never become playable. */
  it.each(['symlink', 'parent-symlink', 'directory', 'path', 'id', 'escape', 'missing-path'])(
    'should mark an unsafe %s candidate missing',
    async (kind) => {
      const c = await makeSUT();
      const seeded = c.seed();
      if (kind === 'symlink') {
        rmSync(seeded.file);
        symlinkSync(c.storage.data, seeded.file);
      }
      if (kind === 'parent-symlink') {
        rmSync(`${c.musicRoot}/imports`, { recursive: true });
        symlinkSync(c.storage.data, `${c.musicRoot}/imports`);
      }
      if (kind === 'directory') {
        rmSync(seeded.file);
        mkdirSync(seeded.file);
      }
      if (kind === 'path') seeded.song.path = 'imports/wrong.mp3';
      if (kind === 'escape') seeded.song.path = `imports/../${seeded.fileKey}`;
      if (kind === 'missing-path') Reflect.deleteProperty(seeded.song, 'path');
      if (kind === 'id') c.state.songIdOverride = 'wrong-id';
      const response = await c.get();
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({ state: 'missing' });
      expect(response.json().items[0]).not.toHaveProperty('song');
    },
  );

  /** Current-account upstream failures retain established authentication and retry semantics. */
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [503, 'upstream_unavailable'],
    [0, 'upstream_unavailable'],
  ] as const)('should map getSong HTTP %i safely', async (status, code) => {
    const c = await makeSUT();
    c.seed();
    c.state.songStatus = status;
    c.state.songStall = status === 0;
    const response = await c.get();
    expect(response.statusCode).toBe(status || 503);
    expect(response.json().error.code).toBe(code);
    expect(response.body).not.toContain('synthetic-secret');
    c.state.songStatus = 0;
    c.state.songStall = false;
    expect((await c.get()).statusCode).toBe(status === 401 ? 401 : 200);
  });

  /** Only bounded page candidates use getSong; neither history nor eligibility crawls the library. */
  it('should use the event index and cap default/max page upstream reads', async () => {
    const c = await makeSUT();
    const sample = c.seed();
    for (let i = 1; i < 102; i++) c.seed();
    const prepared = vi.spyOn(c.storage.db.connection, 'prepare');
    const first = await c.get();
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(50);
    expect(c.requests.filter((u) => u.pathname === '/rest/getSong')).toHaveLength(50);
    const sql = prepared.mock.calls
      .map(([query]) => query)
      .find((query) => query.includes('download_events_recent') && !query.startsWith('EXPLAIN'));
    expect(sql).toBeDefined();
    const plan = c.storage.db.connection
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(sample.identityKey, 'music', 0, recentNow, recentNow, 102, null, null, null, 101);
    expect(plan.map((row) => row.detail).join(' ')).toContain(
      'SEARCH e USING INDEX download_events_recent',
    );
    expect(plan.map((row) => row.detail).join(' ')).not.toMatch(/SCAN (e|i|m)\b/);
    c.requests.length = 0;
    const max = await c.get({ limit: '100' });
    expect(max.json().items).toHaveLength(100);
    expect(c.requests.filter((u) => u.pathname === '/rest/getSong')).toHaveLength(100);
    expect(c.requests.every((u) => ['/rest/getUser', '/rest/getSong'].includes(u.pathname))).toBe(
      true,
    );
    expect(
      c.requests
        .filter((u) => u.pathname === '/rest/getSong')
        .every((u) => u.searchParams.get('u') === password.username),
    ).toBe(true);
  });

  /** Historical availability ignores stopped workers while disabled policies deny access. */
  it('should expose recent capability independently of worker availability and keep auth mandatory', async () => {
    const c = await makeSUT();
    const response = await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers });
    expect(response.json().features['library.recentDownloads']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    expect((await c.get({}, { cookie: '' })).statusCode).toBe(401);
    c.imports.policy.enabled = false;
    expect((await c.get()).statusCode).toBe(403);
    const disabled = createApp(c.options);
    try {
      expect(
        (await disabled.inject({ url: '/api/v1/capabilities', headers: c.headers })).json()
          .features['library.recentDownloads'].supported,
      ).toBe(false);
    } finally {
      await disabled.close();
    }
  });
  /** An explicit future range cannot include completion instants after the first-page asOf. */
  it('should bound a future date range by asOf and permit an unchanged explicit filter on continuation', async () => {
    const c = await makeSUT();
    c.seed({ at: recentNow - 2 });
    c.seed({ at: recentNow - 1 });
    c.seed({ at: recentNow + 1 });
    const query = { from: iso(recentNow - 1000), to: iso(recentNow + 1000), limit: '1' };
    const first = await c.get(query);
    expect(first.statusCode).toBe(200);
    c.setNow(recentNow + 500);
    const second = await c.get({ ...query, cursor: first.json().nextCursor });
    expect(second.statusCode).toBe(200);
    expect(second.json().nextCursor).toBeNull();
    expect(second.json().items[0].song.id).toBe('song-1');
    const [raw, mac] = (first.json().nextCursor as string).split('.');
    const changed = JSON.parse(Buffer.from(raw!, 'base64url').toString());
    changed.asOf += 1;
    expect(
      (
        await c.get({
          cursor: `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${mac}`,
        })
      ).statusCode,
    ).toBe(400);
  });

  /** Public bearer reads use the same account scope, while unrelated users have no policy access. */
  it('should support native bearer reads and deny accounts without an allowed library', async () => {
    const c = await makeSUT();
    c.seed();
    const login = await c.login(
      { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
      native,
    );
    expect(login.statusCode).toBe(201);
    const response = await c.app.inject({
      url: '/api/v1/recent-downloads',
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    const other = await c.login(undefined, { ...password, username: 'denied-user' });
    expect((await c.get({}, { cookie: cookieOf(other) })).statusCode).toBe(403);
  });

  /** Availability is rechecked after getSong, including a concurrent filesystem removal. */
  it('should keep a file deleted during upstream verification missing', async () => {
    const c = await makeSUT();
    const seeded = c.seed();
    c.state.songResponseGate = async () => {
      rmSync(seeded.file);
    };
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].state).toBe('missing');
  });

  /** Revocation during network I/O suppresses already assembled recent metadata. */
  it('should discard the page when the session is revoked before return', async () => {
    const c = await makeSUT();
    c.seed();
    let verified = 0;
    c.state.identityResponseGate = async () => {
      if (++verified === 2) c.storage.instances.bumpPolicyRevision();
    };
    const response = await c.get();
    expect(response.statusCode).toBe(401);
    expect(response.json()).not.toHaveProperty('items');
  });

  /** HTTP-200 Subsonic errors preserve authentication and permission semantics. */
  it.each([
    [40, 401],
    [50, 403],
  ] as const)('should map Subsonic code %i to %i', async (code, status) => {
    const c = await makeSUT();
    c.seed();
    c.state.songError = code;
    expect((await c.get()).statusCode).toBe(status);
  });

  /** Library-root policy changes invalidate earlier cursors even when library IDs are unchanged. */
  it('should bind cursor library mappings as well as library IDs', async () => {
    const c = await makeSUT();
    c.seed();
    c.seed();
    const first = await c.get({ limit: '1' });
    c.imports.policy.libraries[0]!.relativeRoot = 'moved';
    expect((await c.get({ cursor: first.json().nextCursor })).statusCode).toBe(400);
  });

  /** Ready verification uses a bounded number of concurrent upstream requests. */
  it('should never exceed four getSong requests in flight', async () => {
    const c = await makeSUT();
    for (let n = 0; n < 12; n++) c.seed();
    let active = 0;
    let maximum = 0;
    c.state.songResponseGate = async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    expect((await c.get()).statusCode).toBe(200);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
  });
  /** Configured startup connects the read-only root and persistent ledger to the actual HTTP route. */
  it('should resolve ready files through the configured runtime and reject relative roots', async () => {
    const c = await makeSUT();
    const runtimeNow = Date.now();
    const seeded = c.seed({ at: runtimeNow - 1000 });
    const key = loadKey(c.storage.keyPath);
    const runtimeService = createSessionService({ ...c.options, signingKey: key });
    const identity = Buffer.from(
      runtimeService.sign(
        'import-identity',
        JSON.stringify([c.storage.instances.get().id, password.username]),
      ),
      'base64url',
    ).toString('hex');
    c.storage.db.connection
      .prepare('UPDATE download_events SET identity_key=? WHERE id=?')
      .run(identity, seeded.id);
    const policyPath = `${c.storage.root}/import-policy.json`;
    writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        libraries: c.imports.policy.libraries,
        engineManagers: [],
      }),
    );
    const env = {
      PUBLIC_ORIGIN: c.options.origin,
      GONIC_UPSTREAM: c.options.upstream,
      MANAGEMENT_DIRECTORY: c.storage.data,
      CREDENTIAL_KEY_PATH: c.storage.keyPath,
      SESSION_MAX_AGE_SECONDS: '60',
      NODE_ENV: 'production',
      IMPORTS_ENABLED: 'true',
      IMPORT_POLICY_PATH: policyPath,
      IMPORT_MUSIC_ROOT: c.musicRoot,
      IMPORT_WORKER_USERNAME: 'synthetic-worker',
      IMPORT_WORKER_PASSWORD: 'synthetic-worker-proof',
    };
    expect(() => createConfiguredApp({ ...env, IMPORT_MUSIC_ROOT: 'relative' })).toThrow(
      'Invalid authentication configuration',
    );
    const app = createConfiguredApp(env);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: { origin: c.options.origin, 'x-musiclatte-client': 'web' },
        payload: password,
      });
      expect(login.statusCode).toBe(201);
      const query = new URLSearchParams({ from: iso(runtimeNow - week), to: iso(runtimeNow) });
      const response = await app.inject({
        url: `/api/v1/recent-downloads?${query}`,
        headers: { cookie: cookieOf(login) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({
        state: 'ready',
        song: { id: seeded.song.id },
      });
    } finally {
      await app.close();
    }
  });
});
