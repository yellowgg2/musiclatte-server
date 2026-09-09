import { afterEach, expect, it } from 'vitest';
import {
  createListeningContext,
  listeningPayload as payload,
} from '../../../tests/support/listening-harness.js';
const contexts: Awaited<ReturnType<typeof createListeningContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
async function setup(scrobble = true, enabled = true) {
  const c = await createListeningContext(scrobble, enabled);
  contexts.push(c);
  return c;
}
/** Durable receipts prevent retries from dispatching another non-idempotent upstream request. */
it('should retain one local event and submit once on replay', async () => {
  const c = await setup();
  const request = {
    method: 'POST' as const,
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  };
  const first = await c.app.inject(request);
  expect(first.statusCode).toBe(201);
  expect(first.json().delivery.status).toBe('submitted');
  expect((await c.app.inject(request)).json()).toEqual(first.json());
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(1);
  const history = await c.app.inject({ url: '/api/v1/listening/history', headers: c.headers });
  expect(history.statusCode).toBe(200);
  expect(history.json().items).toHaveLength(1);
  const top = await c.app.inject({ url: '/api/v1/listening/top-songs', headers: c.headers });
  expect(top.json().items[0].count).toBe(1);
});
/** A connection dropped after acceptance must stay uncertain through retries and restart recovery. */
it('should keep failed upstream submissions uncertain without replay', async () => {
  const c = await setup();
  c.state.scrobbleDrop = true;
  const request = {
    method: 'POST' as const,
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  };
  const first = await c.app.inject(request);
  expect(first.statusCode).toBe(201);
  expect(first.json().delivery.status).toBe('uncertain');
  c.state.scrobbleDrop = false;
  expect((await c.app.inject(request)).json().delivery.status).toBe('uncertain');
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(1);
});
/** Disabling forwarding keeps local history; disabling the feature exposes no ledger route. */
it('should skip forwarding and keep the feature closed by default', async () => {
  const c = await setup(false);
  const response = await c.app.inject({
    method: 'POST',
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().delivery.status).toBe('skipped');
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(0);
  const off = await setup(false, false);
  expect(
    (await off.app.inject({ url: '/api/v1/listening/history', headers: off.headers })).statusCode,
  ).toBe(404);
});
/** Upstream401 revokes the current session but never removes or resubmits its local event. */
it('should retain the event after upstream authentication failure and relogin', async () => {
  const c = await setup();
  c.state.scrobbleError = 40;
  const request = {
    method: 'POST' as const,
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  };
  expect((await c.app.inject(request)).statusCode).toBe(401);
  c.state.scrobbleError = 0;
  const login = await c.login();
  const headers = {
    ...c.headers,
    cookie: String(login.headers['set-cookie']).split(';')[0]!,
    'x-csrf-token': login.json().csrfToken,
  };
  const replay = await c.app.inject({ ...request, headers });
  expect(replay.statusCode).toBe(201);
  expect(replay.json().delivery.status).toBe('uncertain');
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(1);
});
/** Missing metadata retains history/count, while upstream outages remain explicit errors. */
it('should preserve missing songs and hydrate each page ID only once', async () => {
  const c = await setup(false);
  for (const eventId of ['a'.repeat(22), 'b'.repeat(22)])
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/listening/events',
          headers: c.headers,
          payload: { ...payload, eventId },
        })
      ).statusCode,
    ).toBe(201);
  const before = c.requests.filter((url) => url.pathname === '/rest/getSong').length;
  const page = await c.app.inject({ url: '/api/v1/listening/history', headers: c.headers });
  expect(page.json().items).toHaveLength(2);
  expect(c.requests.filter((url) => url.pathname === '/rest/getSong')).toHaveLength(before + 1);
  c.state.songError = 70;
  const missing = await c.app.inject({ url: '/api/v1/listening/top-songs', headers: c.headers });
  expect(missing.statusCode).toBe(200);
  expect(missing.json().items[0]).toMatchObject({ count: 2, song: null });
  c.state.songError = 0;
  c.state.songStatus = 503;
  expect(
    (await c.app.inject({ url: '/api/v1/listening/history', headers: c.headers })).statusCode,
  ).toBe(503);
});
/** Frozen range, purpose and account binding prevent page contamination by later writes. */
it('should bind pagination to account purpose filters and insertion snapshot', async () => {
  const c = await setup(false);
  const record = (eventId: string) =>
    c.app.inject({
      method: 'POST',
      url: '/api/v1/listening/events',
      headers: c.headers,
      payload: { ...payload, eventId },
    });
  await record('a'.repeat(22));
  await record('b'.repeat(22));
  const first = await c.app.inject({
    url: '/api/v1/listening/history?limit=1',
    headers: c.headers,
  });
  expect(first.statusCode).toBe(200);
  const cursor = first.json().nextCursor;
  expect(cursor).toBeTypeOf('string');
  await record('c'.repeat(22));
  const next = await c.app.inject({
    url: `/api/v1/listening/history?limit=1&cursor=${cursor}`,
    headers: c.headers,
  });
  expect(next.statusCode).toBe(200);
  expect(next.json().items).toHaveLength(1);
  expect(next.json().nextCursor).toBeNull();
  expect(next.json().asOf).toBe(first.json().asOf);
  for (const url of [
    `/api/v1/listening/top-songs?limit=1&cursor=${cursor}`,
    `/api/v1/listening/history?limit=2&cursor=${cursor}`,
    `/api/v1/listening/history?limit=1&cursor=${cursor}x`,
  ])
    expect((await c.app.inject({ url, headers: c.headers })).statusCode).toBe(400);
  const { browserHeaders, password } = await import('../../../tests/support/auth-harness.js');
  c.state.username = 'different-account';
  const login = await c.login(browserHeaders, { ...password, username: c.state.username });
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0]! };
  expect((await c.app.inject({ url: '/api/v1/listening/history', headers })).json().items).toEqual(
    [],
  );
  expect(
    (await c.app.inject({ url: `/api/v1/listening/history?limit=1&cursor=${cursor}`, headers }))
      .statusCode,
  ).toBe(400);
});
/** Replay ignores later age/metadata changes and conflicting payload reuse remains409. */
it('should preserve replay identity after the acceptance window closes', async () => {
  const c = await setup(false);
  const request = {
    method: 'POST' as const,
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  };
  expect((await c.app.inject(request)).statusCode).toBe(201);
  c.advance(86400001);
  c.state.songError = 70;
  expect((await c.app.inject(request)).statusCode).toBe(201);
  expect(
    (await c.app.inject({ ...request, payload: { ...payload, listenedMs: 239999 } })).statusCode,
  ).toBe(409);
  expect(
    (await c.app.inject({ ...request, payload: { ...payload, eventId: 'z'.repeat(22) } }))
      .statusCode,
  ).toBe(400);
});
/** Response-time policy invalidation prevents a late song lookup from creating an event. */
it('should fence a revoked session while validating a new event', async () => {
  const c = await setup();
  let release!: () => void;
  let observed!: () => void;
  const ready = new Promise<void>((r) => {
    observed = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  c.state.songResponseGate = () => {
    observed();
    return gate;
  };
  const pending = c.app.inject({
    method: 'POST',
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  });
  await ready;
  c.storage.db.connection.exec('UPDATE sessions SET revoked_at=created_at,encrypted_proof=NULL');
  release();
  expect((await pending).statusCode).toBe(401);
  expect(
    c.storage.db.connection.prepare('SELECT count(*) AS n FROM listening_events').get()?.n,
  ).toBe(0);
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(0);
});
/** Admission uses actual track duration, not elapsed time alone; unknown-duration falls back to four minutes. */
it('should enforce the actual duration threshold and future timestamp bound', async () => {
  const c = await setup(false);
  const request = { method: 'POST' as const, url: '/api/v1/listening/events', headers: c.headers };
  expect(
    (await c.app.inject({ ...request, payload: { ...payload, listenedMs: 59999 } })).statusCode,
  ).toBe(400);
  expect(
    (await c.app.inject({ ...request, payload: { ...payload, listenedMs: 60000 } })).statusCode,
  ).toBe(201);
  expect(
    (
      await c.app.inject({
        ...request,
        payload: { ...payload, eventId: 'f'.repeat(22), qualifiedAt: '2026-09-09T00:16:00.000Z' },
      })
    ).statusCode,
  ).toBe(400);
});
/** Hydration is page-bounded and never exceeds four concurrent current-song requests. */
it('should hydrate only page songs with at most four concurrent requests', async () => {
  const c = await setup(false);
  c.state.songIdFromRequest = true;
  for (let i = 0; i < 6; i++)
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/listening/events',
          headers: c.headers,
          payload: { ...payload, eventId: String(i).repeat(22), songId: `fixture-${i}` },
        })
      ).statusCode,
    ).toBe(201);
  let active = 0;
  let peak = 0;
  let calls = 0;
  c.state.songResponseGate = async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
  };
  const page = await c.app.inject({ url: '/api/v1/listening/history', headers: c.headers });
  expect(page.statusCode).toBe(200);
  expect(page.json().items).toHaveLength(6);
  expect(calls).toBe(6);
  expect(peak).toBe(4);
});
/** Restoring a historical ledger freezes pending deliveries and invalidates restored sessions. */
it('should never replay pending deliveries from a backup', async () => {
  const c = await setup(false);
  await c.app.inject({
    method: 'POST',
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  });
  const event = {
    identityKey: 'a'.repeat(64),
    eventIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    songId: 'fixture',
    startedAt: 0,
    qualifiedAt: 1,
  };
  const pending = c.repository.insert(event);
  c.repository.claim(pending.sequence);
  c.repository.insert({ ...event, eventIdHash: 'd'.repeat(64) });
  const { join } = await import('node:path');
  const snapshot = join(c.storage.root, 'snapshot');
  const target = join(c.storage.root, 'restored');
  await c.storage.createBackup(c.storage.db, c.storage.keyPath, snapshot);
  await c.storage.restoreBackup(snapshot, target);
  const db = c.storage.open(target);
  expect(
    db.connection
      .prepare(
        "SELECT count(*) AS n FROM listening_deliveries WHERE status IN ('not_sent','dispatching')",
      )
      .get()?.n,
  ).toBe(0);
  expect(
    db.connection.prepare('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL').get()?.n,
  ).toBe(0);
  expect(db.connection.prepare('SELECT count(*) AS n FROM listening_events').get()?.n).toBe(3);
});
/** Unknown duration requires four minutes and a timed-out dispatch stays uncertain. */
it('should require four minutes for unknown duration and never retry timeouts', async () => {
  const c = await setup();
  c.state.songUnknownDuration = true;
  const request = {
    method: 'POST' as const,
    url: '/api/v1/listening/events',
    headers: c.headers,
    payload,
  };
  expect(
    (await c.app.inject({ ...request, payload: { ...payload, listenedMs: 239999 } })).statusCode,
  ).toBe(400);
  c.state.scrobbleStall = true;
  const response = await c.app.inject(request);
  expect(response.statusCode).toBe(201);
  expect(response.json().delivery.status).toBe('uncertain');
  c.state.scrobbleStall = false;
  expect((await c.app.inject(request)).json().delivery.status).toBe('uncertain');
  expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(1);
});
