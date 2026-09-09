import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createImportClient } from '../../web/src/imports/client.js';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  native,
  password,
} from '../../../tests/support/auth-harness.js';

const operationId = (n: number) => `operation_${String(n).padStart(20, '0')}`;
const urls = ['https://youtu.be/abcdefghijk'];

describe('imports API', () => {
  const cleanups: (() => Promise<void>)[] = [];
  async function makeSUT() {
    const ctx = await createTestContext();
    let now = 1000;
    const imports = {
      database: ctx.storage.db,
      policy: {
        enabled: true,
        engineManagers: [],
        libraries: [
          {
            id: 'music',
            musicFolderId: '1',
            relativeRoot: 'imports',
            allowedUsers: [password.username],
          },
          { id: 'other', musicFolderId: '2', relativeRoot: 'other', allowedUsers: ['other-user'] },
        ],
      },
      clock: () => now,
    };
    ctx.storage.engines.initialize('fixture-engine');
    ctx.storage.workerStates.heartbeat({ workerId: 'worker', status: 'idle' });
    const app = createApp({ ...ctx.options, ...{ imports } });
    cleanups.push(async () => {
      await app.close();
      await ctx.cleanup();
    });
    const login = await ctx.login();
    const headers = {
      ...browserHeaders,
      cookie: cookieOf(login),
      'x-csrf-token': login.json().csrfToken as string,
    };
    const create = (n = 1, extra = {}) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/imports',
        headers,
        payload: { operationId: operationId(n), libraryId: 'music', urls, ...extra },
      });
    return {
      ...ctx,
      app,
      imports,
      headers,
      create,
      setNow: (value: number) => {
        now = value;
      },
    };
  }
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** The production browser client satisfies the API JSON/CSRF boundary on bodyless cancellation. */
  it('should cancel a queued job through the production browser client', async () => {
    const c = await makeSUT();
    const created = (await c.create()).json().job;
    const client = createImportClient({
      fetcher: async (input, init) => {
        const response = await c.app.inject({
          method: init?.method as 'DELETE',
          url: String(input),
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            cookie: c.headers.cookie,
            origin: browserHeaders.origin,
          },
        });
        return new Response(response.body, { status: response.statusCode });
      },
    });
    const options = { csrfToken: c.headers['x-csrf-token'], signal: new AbortController().signal };
    const first = await client.cancel(created.id, options);
    expect(first.job.status).toBe('cancelled');
    expect(first.job.items[0]?.stage).toBe('cancelled');
    expect((await client.cancel(created.id, options)).job).toEqual(first.job);
  });

  /** Canonical replay and duplicate admission preserve order without enqueuing a second download. */
  it('should create, replay, conflict and identify an in-flight canonical duplicate', async () => {
    const c = await makeSUT();
    const first = await c.create();
    expect(first.statusCode).toBe(202);
    const job = first.json().job;
    expect(job.items[0]).toMatchObject({ sourceId: 'abcdefghijk', stage: 'queued' });
    expect(job.items[0]).not.toHaveProperty('title');
    expect(
      (await c.create(1, { urls: ['https://www.youtube.com/watch?v=abcdefghijk&t=5'] })).json(),
    ).toEqual(first.json());
    expect((await c.create(1, { urls: ['https://youtu.be/12345678901'] })).statusCode).toBe(409);
    const duplicate = (await c.create(2)).json().job.items[0];
    expect(duplicate).toMatchObject({
      stage: 'duplicate',
      duplicate: { kind: 'item', id: job.items[0].id },
    });
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()?.n,
    ).toBe(0);
    expect(
      (await c.app.inject({ url: `/api/v1/imports/${job.id}`, headers: c.headers })).json(),
    ).toEqual(first.json());
    expect(first.body).not.toMatch(
      /identityKey|requestHash|leaseOwner|relativeRoot|https:|stderr|credential/,
    );
  });

  it('should admit a radio watch URL as one video and replay its canonical link', async () => {
    const c = await makeSUT();
    const result = await c.create(1, {
      urls: ['https://www.youtube.com/watch?v=s3_uirvnSdI&list=RDVf2PhH7d7j0&index=20'],
    });
    expect(result.statusCode).toBe(202);
    expect(result.json().job.items).toHaveLength(1);
    expect(result.json().job.items[0].sourceId).toBe('s3_uirvnSdI');
    expect((await c.create(1, { urls: ['https://youtu.be/s3_uirvnSdI'] })).json()).toEqual(
      result.json(),
    );
  });

  /** Every input surface rejects forged body/query and browser mutation proofs. */
  it('should reject invalid schema, source, library, authentication and CSRF inputs', async () => {
    const c = await makeSUT();
    expect((await c.app.inject('/api/v1/imports')).statusCode).toBe(401);
    for (const extra of [{ extra: true }, { operationId: 'short' }, { urls: [] }, { urls: [42] }])
      expect((await c.create(1, extra)).statusCode).toBe(400);
    expect((await c.create(1, { urls: ['https://evil.test/private'] })).statusCode).toBe(422);
    expect((await c.create(1, { libraryId: 'other' })).statusCode).toBe(403);
    for (const query of ['?extra=x', '?limit=101', '?limit=0', '?limit=1&limit=2', '?cursor=bad'])
      expect(
        (await c.app.inject({ url: `/api/v1/imports${query}`, headers: c.headers })).statusCode,
      ).toBe(400);
    for (const patch of [
      { origin: 'https://evil.test' },
      { 'x-csrf-token': 'bad' },
      { 'x-musiclatte-client': 'native' },
    ])
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/imports',
            headers: { ...c.headers, ...patch },
            payload: { operationId: operationId(1), libraryId: 'music', urls },
          })
        ).statusCode,
      ).toBe(403);
    expect((await c.create(1, { urls: Array(600).fill(urls[0]) })).statusCode).toBe(413);
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/imports',
          headers: { ...c.headers, 'content-type': 'text/plain' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(415);
  });

  /** Signed pagination and job handles are scoped to current account and instance, including bearer reads. */
  it('should paginate and reject cross-account and cross-instance handles', async () => {
    const c = await makeSUT();
    const first = await c.create(1);
    await c.create(2);
    const list = await c.app.inject({ url: '/api/v1/imports?limit=1', headers: c.headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs).toHaveLength(1);
    expect(list.json().libraries).toEqual([{ id: 'music' }]);
    const cursor = list.json().nextCursor;
    expect(typeof cursor).toBe('string');
    const next = await c.app.inject({
      url: `/api/v1/imports?limit=1&cursor=${cursor}`,
      headers: c.headers,
    });
    expect(next.json().jobs).toHaveLength(1);
    expect(next.json().jobs[0].id).not.toBe(list.json().jobs[0].id);
    const bearer = await c.login(
      { 'x-musiclatte-client': 'native', 'content-type': 'application/json' },
      native,
    );
    expect(
      (
        await c.app.inject({
          url: '/api/v1/imports',
          headers: { authorization: `Bearer ${bearer.json().accessToken}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/imports',
          headers: {
            authorization: `Bearer ${bearer.json().accessToken}`,
            'content-type': 'application/json',
          },
          payload: { operationId: operationId(3), libraryId: 'music', urls },
        })
      ).statusCode,
    ).toBe(403);
    c.state.accountIdentityFromProof = true;
    const other = await c.login(browserHeaders, { ...password, username: 'other-user' });
    const otherHeaders = { ...browserHeaders, cookie: cookieOf(other) };
    expect(
      (await c.app.inject({ url: `/api/v1/imports/${first.json().job.id}`, headers: otherHeaders }))
        .statusCode,
    ).toBe(404);
    expect(
      (await c.app.inject({ url: `/api/v1/imports?cursor=${cursor}`, headers: otherHeaders }))
        .statusCode,
    ).toBe(400);
    const d = await makeSUT();
    expect(
      (await d.app.inject({ url: `/api/v1/imports/${first.json().job.id}`, headers: d.headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await d.app.inject({ url: `/api/v1/imports?cursor=${cursor}`, headers: d.headers }))
        .statusCode,
    ).toBe(400);
  });

  /** Cancel is cooperative and terminal replay preserves timestamps; retries contain only failed items in source order. */
  it('should cancel idempotently and retry failed items in original order', async () => {
    const c = await makeSUT();
    const response = await c.create(1, { urls: [...urls, 'https://youtu.be/12345678901'] });
    expect(response.statusCode).toBe(202);
    const job = response.json().job;
    const claim = () =>
      c.storage.imports.claimNext({
        workerId: 'worker',
        leaseDurationMs: 1000,
        engineVersion: 'fixture-engine',
      })!;
    for (let i = 0; i < 2; i++)
      c.storage.imports.failItem({
        itemId: claim().id,
        workerId: 'worker',
        failureCode: 'download_failed',
      });
    const retry = () =>
      c.app.inject({
        method: 'POST',
        url: `/api/v1/imports/${job.id}/retries`,
        headers: c.headers,
        payload: {
          operationId: operationId(2),
          itemIds: job.items.map((item: { id: string }) => item.id).reverse(),
        },
      });
    const retried = await retry();
    expect(retried.statusCode).toBe(202);
    expect(retried.json().job.retryOfJobId).toBe(job.id);
    expect(retried.json().job.items.map((item: { sourceId: string }) => item.sourceId)).toEqual([
      'abcdefghijk',
      '12345678901',
    ]);
    expect((await retry()).json()).toEqual(retried.json());
    const cancel = () =>
      c.app.inject({
        method: 'DELETE',
        url: `/api/v1/imports/${retried.json().job.id}`,
        headers: c.headers,
      });
    const cancelled = await cancel();
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe('cancelled');
    expect((await cancel()).json()).toEqual(cancelled.json());
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/imports/${job.id}`,
          headers: c.headers,
        })
      ).json().job.cancelRequestedAt,
    ).toBeNull();
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/imports/${job.id}?x=1`,
          headers: c.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/imports/${job.id}`,
          headers: c.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });

  /** Capability is a persisted-state read and unavailable workers do not prevent history or cancellation. */
  it('should distinguish disabled, denied and stale worker or engine capabilities', async () => {
    const c = await makeSUT();
    const get = async () =>
      (await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers })).json().features[
        'imports.youtube'
      ];
    expect(await get()).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    c.setNow(31_000);
    expect(await get()).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'temporarily_unavailable',
    });
    expect((await c.create()).statusCode).toBe(503);
    expect((await c.app.inject({ url: '/api/v1/imports', headers: c.headers })).statusCode).toBe(
      200,
    );
    c.setNow(999);
    expect((await get()).availability).toBe('temporarily_unavailable');
    c.setNow(1000);
    c.storage.engines.recordCheck({ status: 'failed', succeeded: false });
    expect((await get()).availability).toBe('available');
    c.imports.policy.libraries[0]!.allowedUsers = [];
    expect(await get()).toEqual({
      supported: true,
      permission: 'denied',
      availability: 'available',
    });
    c.imports.policy.enabled = false;
    expect(await get()).toEqual({
      supported: false,
      permission: 'denied',
      availability: 'available',
    });
    expect(c.requests.some((url) => /startScan|download/.test(url.pathname))).toBe(false);
  });
  /** A claimed operation remains replayable during worker downtime without accepting new work. */
  it('should replay a claimed create while the worker is unavailable', async () => {
    const c = await makeSUT();
    const first = await c.create();
    expect(first.statusCode).toBe(202);
    c.storage.workerStates.stop();
    expect((await c.create()).json()).toEqual(first.json());
    expect((await c.create(1, { urls: ['https://youtu.be/12345678901'] })).statusCode).toBe(409);
    expect((await c.create(2)).statusCode).toBe(503);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/imports/${first.json().job.id}`,
          headers: c.headers,
        })
      ).statusCode,
    ).toBe(200);
  });

  /** Session invalidation during final identity I/O suppresses an already computed response. */
  it('should reject expired sessions and late responses after policy revocation', async () => {
    const c = await makeSUT();
    let calls = 0;
    c.state.identityResponseGate = async () => {
      if (++calls === 2) c.storage.instances.bumpPolicyRevision();
    };
    const response = await c.create();
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('sourceId');
    expect(c.storage.db.connection.prepare('SELECT count(*) AS n FROM import_jobs').get()?.n).toBe(
      1,
    );
    expect((await c.app.inject({ url: '/api/v1/imports', headers: c.headers })).statusCode).toBe(
      401,
    );
    const d = await makeSUT();
    d.storage.setNow(2000);
    expect((await d.create()).statusCode).toBe(401);
    expect(d.storage.db.connection.prepare('SELECT count(*) AS n FROM import_jobs').get()?.n).toBe(
      0,
    );
  });

  /** Ready media is referenced directly and nonfailed stages can never enter a retry job. */
  it('should preserve ready media and reject queued, duplicate, registering and ready retries', async () => {
    const c = await makeSUT();
    const first = await c.create();
    expect(first.statusCode).toBe(202);
    const job = first.json().job;
    const retry = (id: string, itemId: string) =>
      c.app.inject({
        method: 'POST',
        url: `/api/v1/imports/${id}/retries`,
        headers: c.headers,
        payload: { operationId: operationId(8), itemIds: [itemId] },
      });
    expect((await retry(job.id, job.items[0].id)).statusCode).toBe(422);
    const duplicate = (await c.create(2)).json().job;
    expect((await retry(duplicate.id, duplicate.items[0].id)).statusCode).toBe(422);
    const item = c.storage.imports.claimNext({
      workerId: 'worker',
      leaseDurationMs: 1000,
      engineVersion: 'fixture-engine',
    })!;
    c.storage.imports.advanceItem({
      itemId: item.id,
      workerId: 'worker',
      stage: 'downloading',
      observed: { title: 'Synthetic title', channel: 'Synthetic channel', channelId: 'channel' },
    });
    c.storage.imports.advanceItem({ itemId: item.id, workerId: 'worker', stage: 'postprocessing' });
    c.storage.imports.advanceItem({ itemId: item.id, workerId: 'worker', stage: 'publishing' });
    c.storage.imports.recordPublished({ itemId: item.id, workerId: 'worker', eventId: 'event' });
    expect((await retry(job.id, job.items[0].id)).statusCode).toBe(422);
    c.storage.mediaLinks.create({
      id: 'media',
      libraryId: 'music',
      relativeFileKey: 'private/synthetic.mp3',
      gonicSongId: 'song',
    });
    c.storage.imports.finishRegistration({
      itemId: item.id,
      workerId: 'worker',
      mediaLinkId: 'media',
    });
    expect((await retry(job.id, job.items[0].id)).statusCode).toBe(422);
    const readyDuplicate = await c.create(3);
    expect(readyDuplicate.json().job.items[0]).toMatchObject({
      stage: 'queued',
    });
    const cancelled = await c.app.inject({
      method: 'DELETE',
      url: `/api/v1/imports/${job.id}`,
      headers: c.headers,
    });
    expect(cancelled.json().job.cancelRequestedAt).toBeNull();
    expect(cancelled.body).not.toContain('private/');
    expect(cancelled.json().job.items[0]).toMatchObject({
      stage: 'ready',
      title: 'Synthetic title',
      channel: 'Synthetic channel',
    });
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()?.n,
    ).toBe(1);
    expect(c.storage.mediaLinks.get('media')?.availability).toBe('available');
  });

  /** Duplicate admission is durable across connections, repeated URLs, and accounts sharing a library. */
  it('should admit one runnable source across concurrent operations and reopen', async () => {
    const c = await makeSUT();
    const responses = await Promise.all([c.create(1), c.create(2)]);
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);
    const stages = responses.map((response) => response.json().job.items[0].stage).sort();
    expect(stages).toEqual(['duplicate', 'queued']);
    const reopened = c.storage.open();
    expect(
      reopened.connection
        .prepare("SELECT count(*) AS n FROM import_items WHERE stage='queued'")
        .get()?.n,
    ).toBe(1);
    expect(reopened.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const backup = `${c.storage.root}/import-backup`;
    const restore = `${c.storage.root}/import-restored`;
    await c.storage.createBackup(c.storage.db, c.storage.keyPath, backup);
    await c.storage.restoreBackup(backup, restore);
    const restored = c.storage.open(restore);
    expect(
      restored.connection
        .prepare('SELECT count(*) AS n FROM import_items WHERE duplicate_of_item_id IS NOT NULL')
        .get()?.n,
    ).toBe(1);
    expect(restored.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const batch = await c.create(3, {
      urls: ['https://youtu.be/12345678901', 'https://www.youtube.com/watch?v=12345678901'],
    });
    expect(batch.json().job.items.map((item: { stage: string }) => item.stage)).toEqual([
      'queued',
      'duplicate',
    ]);
    c.imports.policy.libraries[0]!.allowedUsers.push('other-user');
    c.state.accountIdentityFromProof = true;
    const other = await c.login(browserHeaders, { ...password, username: 'other-user' });
    const otherResponse = await c.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(other),
        'x-csrf-token': other.json().csrfToken,
      },
      payload: { operationId: operationId(1), libraryId: 'music', urls },
    });
    expect(otherResponse.statusCode).toBe(202);
    expect(otherResponse.json().job.items[0].stage).toBe('queued');
    expect(
      reopened.connection
        .prepare('SELECT DISTINCT account_directory FROM import_jobs ORDER BY account_directory')
        .all(),
    ).toHaveLength(2);
    expect(
      reopened.connection
        .prepare(
          "SELECT count(*) AS n FROM import_items WHERE source_id='abcdefghijk' AND stage='queued'",
        )
        .get()?.n,
    ).toBe(2);
  });
  /** History defaults to 20 and signed cursors reject tampering or policy library changes. */
  it('should bound history pages and invalidate cursors after library scope changes', async () => {
    const c = await makeSUT();
    for (let n = 0; n < 21; n++) expect((await c.create(n)).statusCode).toBe(202);
    const list = await c.app.inject({ url: '/api/v1/imports', headers: c.headers });
    expect(list.json().jobs).toHaveLength(20);
    const cursor = list.json().nextCursor as string;
    expect(
      (await c.app.inject({ url: `/api/v1/imports?cursor=${cursor}x`, headers: c.headers }))
        .statusCode,
    ).toBe(400);
    c.imports.policy.libraries[1]!.allowedUsers.push(password.username);
    expect(
      (await c.app.inject({ url: `/api/v1/imports?cursor=${cursor}`, headers: c.headers }))
        .statusCode,
    ).toBe(400);
    const allowed = await c.app.inject({ url: '/api/v1/imports?limit=100', headers: c.headers });
    expect(allowed.json().jobs).toHaveLength(21);
    expect(allowed.json().nextCursor).toBeNull();
    const secondLibrary = await c.create(30, { libraryId: 'other' });
    expect(secondLibrary.json().job.items[0].stage).toBe('queued');
    c.imports.policy.libraries[1]!.allowedUsers = ['other-user'];
    expect(
      (
        await c.app.inject({
          url: `/api/v1/imports/${secondLibrary.json().job.id}`,
          headers: c.headers,
        })
      ).statusCode,
    ).toBe(403);
  });

  /** A running worker owns process termination while cancellation records only the request. */
  it('should keep a claimed item running until worker acknowledgement and redact unknown failure text', async () => {
    const c = await makeSUT();
    const first = await c.create();
    const item = c.storage.imports.claimNext({
      workerId: 'worker',
      leaseDurationMs: 1000,
      engineVersion: 'fixture-engine',
    })!;
    const cancelled = await c.app.inject({
      method: 'DELETE',
      url: `/api/v1/imports/${first.json().job.id}`,
      headers: c.headers,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job).toMatchObject({ status: 'running', cancelRequestedAt: 1000 });
    c.storage.imports.failItem({
      itemId: item.id,
      workerId: 'worker',
      failureCode: '/private/synthetic-stderr-credential',
    });
    const detail = await c.app.inject({
      url: `/api/v1/imports/${first.json().job.id}`,
      headers: c.headers,
    });
    expect(detail.json().job.items[0].failureCode).toBe('download_failed');
    expect(detail.body).not.toMatch(/private|stderr|credential/);
  });
});
