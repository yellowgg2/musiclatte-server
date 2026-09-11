import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createRecentContext, recentNow } from '../../../tests/support/recent-harness.js';
import { browserHeaders, cookieOf, password } from '../../../tests/support/auth-harness.js';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import { createApp } from '../src/app.js';
import { createMetadataRepository } from '../src/storage/metadata-repository.js';
import { metadataReady } from '../src/metadata/provider.js';
import { metadataVerifiedProfile, readApiMetadataOptions } from '../src/metadata/api-config.js';

const toolchain = join(homedir(), '.cache/musiclatte-toolchain');
const runtime = {
  python: process.env.METADATA_TEST_PYTHON ?? join(toolchain, 'metadata-python/bin/python'),
  ffmpeg: process.env.METADATA_TEST_FFMPEG ?? join(toolchain, 'ffmpeg-9.0.1/ffmpeg'),
  ffprobe: process.env.METADATA_TEST_FFPROBE ?? join(toolchain, 'ffmpeg-9.0.1/ffprobe'),
  helperPath: resolve('apps/api/helpers/metadata.py'),
  timeoutMs: 60000,
  maxFileBytes: 10 * 1024 * 1024,
};
const operationId = (n: number) => `metadata_operation_${String(n).padStart(20, '0')}`;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function makeSUT() {
  const c = await createRecentContext();
  const root = join(c.musicRoot, 'imports');
  mkdirSync(root);
  await createMetadataFixture({ root, ...runtime, version: 4 });
  c.songs.push({ id: 'track-1', title: 'Indexed title', isDir: false, path: 'imports/source.mp3' });
  const uploadRoot = join(realpathSync(c.storage.root), 'metadata-uploads');
  mkdirSync(uploadRoot, { mode: 0o700 });
  let ready = true;
  const metadata = {
    database: c.storage.db,
    clock: () => recentNow,
    runtime: { ...runtime, musicRoot: c.musicRoot },
    uploadRoot,
    workerReady: () => ready,
    verifiedProfile: true,
    policy: {
      schemaVersion: 1 as const,
      enabled: true,
      libraries: [
        {
          id: 'music',
          musicFolderId: '0',
          relativeRoot: 'imports',
          editors: [password.username],
          writeProfile: 'exclusive' as const,
          preserveOwnership: true,
        },
      ],
      restoreManagers: [password.username],
      limits: { maxTargets: 64, maxFileBytes: runtime.maxFileBytes, timeoutMs: 60000 },
    },
  };
  const app = createApp({ ...c.options, metadata });
  cleanups.push(async () => {
    await app.close();
    await c.cleanup();
  });
  const login = await c.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken as string,
  };
  const get = (url = '/api/v1/tracks/track-1/metadata', supplied = headers) =>
    app.inject({ url, headers: supplied });
  const post = (url: string, payload: object, supplied = headers) =>
    app.inject({ method: 'POST', url: `/api/v1/${url}`, headers: supplied, payload });
  return {
    ...c,
    app,
    metadata,
    headers,
    root,
    get,
    post,
    unavailable: () => {
      ready = false;
    },
  };
}
describe('metadata API', () => {
  /** Runtime advertisement needs the validated profile and a recent non-future worker heartbeat. */
  it('should keep the opt-in producer unavailable without its profile and worker health', async () => {
    const c = await makeSUT();
    expect(readApiMetadataOptions({}, c.storage.db, () => recentNow)).toBeUndefined();
    const policyPath = join(c.storage.root, 'metadata-policy.json');
    writeFileSync(policyPath, JSON.stringify(c.metadata.policy), { mode: 0o600 });
    const env = {
      METADATA_ENABLED: 'true',
      METADATA_POLICY_PATH: policyPath,
      METADATA_MUSIC_ROOT: c.musicRoot,
      METADATA_PYTHON: runtime.python,
      METADATA_HELPER_PATH: runtime.helperPath,
      METADATA_FFMPEG: runtime.ffmpeg,
      METADATA_FFPROBE: runtime.ffprobe,
      METADATA_UPLOAD_ROOT: c.metadata.uploadRoot,
    };
    const withoutProfile = readApiMetadataOptions(env, c.storage.db, () => recentNow)!;
    expect(metadataReady(withoutProfile)).toBe(false);
    const configured = readApiMetadataOptions(
      { ...env, METADATA_WRITE_PROFILE: metadataVerifiedProfile },
      c.storage.db,
      () => recentNow,
    )!;
    expect(metadataReady(configured)).toBe(false);
    c.storage.db.connection
      .prepare(
        "UPDATE metadata_worker_state SET status='idle',worker_id='worker',heartbeat_at=? WHERE singleton=1",
      )
      .run(recentNow);
    expect(metadataReady(configured)).toBe(true);
    expect(metadataReady(withoutProfile)).toBe(false);
    for (const at of [recentNow + 1, recentNow - 30000]) {
      c.storage.db.connection
        .prepare('UPDATE metadata_worker_state SET heartbeat_at=? WHERE singleton=1')
        .run(at);
      expect(metadataReady(configured)).toBe(false);
    }
    c.metadata.policy.libraries[0]!.musicFolderId = 'unavailable-folder';
    expect((await c.get('/api/v1/capabilities')).json().features['metadata.write'].permission).toBe(
      'denied',
    );
  });
  /** Expiry cleanup never removes a payload referenced by a durable job. */
  it('should retain consumed covers and remove only expired unreferenced uploads', async () => {
    const c = await makeSUT();
    const snapshot = (await c.get()).json();
    const upload = async (n: number) => {
      const response = await c.app.inject({
        method: 'POST',
        url: '/api/v1/metadata-covers',
        headers: {
          ...c.headers,
          'content-type': 'image/png',
          'x-operation-id': operationId(n),
          'x-metadata-library-id': 'music',
        },
        payload: readFileSync(join(c.root, 'new.png')),
      });
      expect(response.statusCode).toBe(201);
      return response.json();
    };
    const kept = await upload(50);
    const expired = await upload(51);
    const targets = [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }];
    const patch = { cover: { op: 'set', selector: { kind: 'new' }, uploadId: kept.uploadId } };
    expect(
      (await c.post('metadata-jobs', { operationId: operationId(52), targets, patch })).statusCode,
    ).toBe(202);
    const expiredKey = c.storage.db.connection
      .prepare('SELECT relative_key FROM metadata_cover_uploads WHERE id=?')
      .get(expired.uploadId)!.relative_key;
    c.storage.db.connection.exec('UPDATE metadata_cover_uploads SET expires_at=created_at');
    await upload(53);
    expect(existsSync(join(c.metadata.uploadRoot, String(expiredKey)))).toBe(false);
    expect((await c.get(expired.previewUrl)).statusCode).toBe(404);
    expect((await c.get(kept.previewUrl)).statusCode).toBe(200);
    expect((await c.post('metadata-previews', { targets, patch })).statusCode).toBe(200);
  });
  /** Only failed unsaved items can be retried, while accepted history survives missing file tools. */
  it('should create a failed-only child retry and preserve replay and history without the music mount', async () => {
    const c = await makeSUT();
    const snapshot = (await c.get()).json();
    const body = {
      operationId: operationId(30),
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
      patch: { title: { op: 'clear' } },
    };
    const job = (await c.post('metadata-jobs', body)).json().job;
    const repo = createMetadataRepository(c.metadata);
    const claim = repo.claimNext({ workerId: 'synthetic-worker', leaseDurationMs: 10000 })!;
    repo.transition({ ...claim, stage: 'failed', errorCode: 'read_only' });
    const retry = {
      operationId: operationId(31),
      items: [{ itemId: claim.itemId, expectedRevision: snapshot.fileRevision }],
    };
    const response = await c.post(`metadata-jobs/${job.id}/retries`, retry);
    expect(response.statusCode).toBe(202);
    expect(response.json().job).toMatchObject({
      kind: 'retry',
      parentJobId: job.id,
      items: [{ stage: 'queued' }],
    });
    expect((await c.post(`metadata-jobs/${job.id}/retries`, retry)).json()).toEqual(
      response.json(),
    );
    expect(
      (
        await c.post(`metadata-jobs/${job.id}/restores`, {
          operationId: operationId(32),
          itemId: claim.itemId,
          currentExpectedRevision: snapshot.fileRevision,
        })
      ).statusCode,
    ).toBe(403);
    renameSync(c.musicRoot, `${c.musicRoot}-unmounted`);
    c.unavailable();
    expect((await c.get(`/api/v1/metadata-jobs/${job.id}`)).statusCode).toBe(200);
    const page = await c.get('/api/v1/metadata-jobs?limit=1');
    expect(page.statusCode).toBe(200);
    expect(page.json().jobs).toHaveLength(1);
    expect(typeof page.json().nextCursor).toBe('string');
    const next = (
      await c.get(
        `/api/v1/metadata-jobs?limit=1&cursor=${encodeURIComponent(page.json().nextCursor)}`,
      )
    ).json();
    expect(next.jobs).toHaveLength(1);
    expect(next.jobs[0].id).not.toBe(page.json().jobs[0].id);
    expect(next.nextCursor).toBeNull();
    expect((await c.post('metadata-jobs', body)).statusCode).toBe(202);
  });
  /** Restore preview returns original metadata only to the scoped restore actor, without backup locations. */
  it('should expose a revision-fenced restore comparison without private backup access', async () => {
    const c = await makeSUT();
    c.state.adminRole = true;
    const snapshot = (await c.get()).json();
    const response = await c.post('metadata-jobs', {
      operationId: operationId(61),
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
      patch: { title: { op: 'clear' } },
    });
    const job = response.json().job;
    const repo = createMetadataRepository(c.metadata);
    const claim = repo.claimNext({ workerId: 'preview-worker', leaseDurationMs: 10000 })!;
    const work = repo.readWork(claim);
    repo.recordBackup({
      ...claim,
      backup: {
        id: 'preview-backup',
        relativeKey: 'private-original.backup',
        preimageDigest: work.expectedDigest,
        size: 1,
        mode: 0o644,
        ownerProfile: { uid: 1000, gid: 1000 },
      },
    });
    repo.transition({ ...claim, stage: 'backed_up' });
    repo.transition({ ...claim, stage: 'prepared' });
    repo.transition({
      ...claim,
      stage: 'file_saved',
      resultDigest: work.expectedDigest,
      resultRevision: snapshot.fileRevision,
    });
    const url = `/api/v1/metadata-jobs/${job.id}/items/${claim.itemId}/restore-preview`;
    expect((await c.get(url)).statusCode, 'pending projection must be explicit').toBe(503);
    const original = {
      values: { ...snapshot.values, title: 'Original before editing' },
      lyricsFrames: snapshot.lyricsFrames,
      covers: [],
    };
    c.storage.db.connection
      .prepare('INSERT INTO metadata_backup_previews(backup_id,summary_json) VALUES(?,?)')
      .run('preview-backup', JSON.stringify(original));
    const preview = await c.get(url);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      jobId: job.id,
      itemId: claim.itemId,
      original,
      current: { fileRevision: snapshot.fileRevision },
    });
    expect(preview.body).not.toContain('private-original.backup');
    expect((await c.get(url.replace(claim.itemId, 'foreign-item'))).statusCode).toBe(404);
    c.metadata.policy.restoreManagers = [];
    expect((await c.get(url)).statusCode).toBe(403);
  });
  /** Two current, writable libraries still require separate edits rather than an implicit cross-root job. */
  it('should reject cross-library bulk before any job is created', async () => {
    const c = await makeSUT();
    mkdirSync(join(c.musicRoot, 'second'));
    copyFileSync(join(c.root, 'source.mp3'), join(c.musicRoot, 'second/source.mp3'));
    c.metadata.policy.libraries.push({
      ...c.metadata.policy.libraries[0]!,
      id: 'second',
      relativeRoot: 'second',
    });
    c.songs.push({
      id: 'track-2',
      title: 'Synthetic second',
      isDir: false,
      path: 'second/source.mp3',
    });
    const first = (await c.get()).json();
    const second = (await c.get('/api/v1/tracks/track-2/metadata')).json();
    const response = await c.post('metadata-jobs', {
      operationId: operationId(40),
      targets: [
        { trackId: 'track-1', expectedRevision: first.fileRevision },
        { trackId: 'track-2', expectedRevision: second.fileRevision },
      ],
      patch: { album: { op: 'clear' } },
    });
    expect(response.statusCode).toBe(400);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()?.n,
    ).toBe(0);
  });
  /** The feed emits receipt status changes and the new cover route does not forward stale validators. */
  it('should expose scoped reflection changes, durable rechecks and fresh cover generations', async () => {
    const c = await makeSUT();
    c.state.adminRole = true;
    const snapshot = (await c.get()).json();
    const submitted = await c.post('metadata-jobs', {
      operationId: operationId(10),
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
      patch: { title: { op: 'clear' } },
    });
    expect(submitted.statusCode).toBe(202);
    const job = submitted.json().job;
    const repository = createMetadataRepository(c.metadata);
    const claim = repository.claimNext({ workerId: 'synthetic-worker', leaseDurationMs: 10000 })!;
    const work = repository.readWork(claim);
    repository.recordReferences(claim, { trackId: 'track-1', starred: false, playlists: [] });
    repository.recordBackup({
      ...claim,
      backup: {
        id: 'synthetic-backup',
        relativeKey: 'synthetic.backup',
        preimageDigest: work.expectedDigest,
        size: 1,
        mode: 0o644,
        ownerProfile: { uid: 1000, gid: 1000 },
      },
    });
    repository.transition({ ...claim, stage: 'backed_up' });
    repository.transition({ ...claim, stage: 'prepared' });
    repository.transition({
      ...claim,
      stage: 'file_saved',
      resultRevision: 'a'.repeat(64),
      resultDigest: 'b'.repeat(64),
    });
    repository.transition({ ...claim, stage: 'reflecting' });
    const evidence = {
      evidence: { synthetic: true },
      relatedIds: { trackIds: ['track-1'], albumIds: [], artistIds: [], coverIds: ['cover-1'] },
    };
    repository.recordReflection(claim, { ...evidence, status: 'reflection_mismatch' });
    const feed = await c.get('/api/v1/metadata-changes');
    expect(feed.statusCode).toBe(200);
    expect(feed.json().changes).toMatchObject([
      { newTrackId: 'track-1', reflection: 'reflection_mismatch', reflectedAt: null },
    ]);
    const body = { operationId: operationId(11), itemIds: [work.itemId] };
    const url = `metadata-jobs/${job.id}/rechecks`;
    const rechecked = await c.post(url, body);
    expect(rechecked.statusCode).toBe(202);
    expect(repository.readWork(claim).stage).toBe('reflecting');
    const renewed = await c.login();
    const renewedHeaders = {
      ...browserHeaders,
      cookie: cookieOf(renewed),
      'x-csrf-token': renewed.json().csrfToken as string,
    };
    expect((await c.post(url, body, renewedHeaders)).statusCode).toBe(202);
    expect(repository.readWork(claim).actorSessionId).toBe(work.actorSessionId);
    expect(
      (await c.post(url, { ...body, operationId: operationId(13) }, renewedHeaders)).statusCode,
    ).toBe(202);
    expect(repository.readWork(claim).actorSessionId).not.toBe(work.actorSessionId);
    repository.recordReflection(claim, { ...evidence, status: 'verified' });
    const delta = await c.get(
      `/api/v1/metadata-changes?cursor=${encodeURIComponent(feed.json().nextCursor)}`,
    );
    expect(delta.json().changes).toMatchObject([
      { reflection: 'verified', reflectedAt: recentNow },
    ]);
    expect(delta.json().changes).toHaveLength(1);
    const restoreBody = {
      operationId: operationId(12),
      itemId: work.itemId,
      currentExpectedRevision: snapshot.fileRevision,
    };
    expect(
      (
        await c.post(`metadata-jobs/${job.id}/restores`, {
          ...restoreBody,
          currentExpectedRevision: 'stale',
        })
      ).statusCode,
    ).toBe(409);
    const restored = await c.post(`metadata-jobs/${job.id}/restores`, restoreBody);
    expect(restored.statusCode).toBe(202);
    expect(restored.json().job).toMatchObject({
      kind: 'restore',
      parentJobId: job.id,
      items: [{ stage: 'queued' }],
    });
    c.unavailable();
    expect((await c.post(url, body)).statusCode).toBe(202);
    expect((await c.post(url, { ...body, itemIds: ['different-item'] })).statusCode).toBe(409);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()?.n,
    ).toBe(2);
    const original = await c.get('/api/v1/media/cover/cover-1');
    const fresh = await c.get(`/api/v1/media/cover/cover-1/revisions/${'a'.repeat(64)}`, {
      ...c.headers,
      'if-none-match': original.headers.etag,
    } as typeof c.headers);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers['cache-control']).toBe('private, no-store');
    expect(c.mediaRequests.at(-1)?.ifNoneMatch).toBeUndefined();
    expect(c.mediaRequests.at(-1)?.url.searchParams.has('revision')).toBe(false);
    expect((await c.get('/api/v1/media/cover/cover-1/revisions/forged')).statusCode).toBe(404);
    const other = await c.login(browserHeaders, { ...password, username: 'other-user' });
    expect(
      (await c.get(`/api/v1/metadata-jobs/${job.id}`, { ...c.headers, cookie: cookieOf(other) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await c.get(
          `/api/v1/metadata-changes?cursor=${encodeURIComponent(feed.json().nextCursor)}`,
          { ...c.headers, cookie: cookieOf(other) },
        )
      ).statusCode,
    ).toBe(400);
  });
  /** Long upstream IDs remain opaque; strict guards reject malformed intent without enqueuing. */
  it('should accept long opaque track IDs and reject stale, duplicate and unknown intent', async () => {
    const c = await makeSUT();
    const trackId = `opaque-${'a'.repeat(1800)}`;
    c.songs[0]!.id = trackId;
    const response = await c.get(`/api/v1/tracks/${trackId}/metadata`);
    expect(response.statusCode).toBe(200);
    const targets = [{ trackId, expectedRevision: response.json().fileRevision }];
    const body = { operationId: operationId(20), targets, patch: { title: { op: 'clear' } } };
    for (const extra of [
      { privatePath: '/private/path' },
      { patch: { unknown: { op: 'clear' } } },
      { targets: [...targets, { trackId, expectedRevision: 'different' }] },
    ])
      expect((await c.post('metadata-jobs', { ...body, ...extra })).statusCode).toBe(400);
    expect(
      (
        await c.post('metadata-jobs', {
          ...body,
          targets: [{ trackId, expectedRevision: 'stale' }],
        })
      ).statusCode,
    ).toBe(409);
    expect((await c.post('metadata-jobs?unknown=1', body)).statusCode).toBe(400);
    expect((await c.get(`/api/v1/tracks/${trackId}/metadata?unknown=1`)).statusCode).toBe(400);
    expect(
      (
        await c.post(
          'metadata-previews',
          { targets, patch: body.patch },
          { ...c.headers, 'x-csrf-token': 'forged' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()?.n,
    ).toBe(0);
    expect((await c.post('metadata-jobs', body)).statusCode).toBe(202);
  });
  /** Empty managed history is a resumable scoped feed, without walking upstream directories. */
  it('should issue an account and policy-bound change cursor without a library scan', async () => {
    const c = await makeSUT();
    const response = await c.get('/api/v1/metadata-changes');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, changes: [], hasMore: false });
    expect(typeof response.json().nextCursor).toBe('string');
    expect(
      c.requests.filter((url) =>
        ['getIndexes', 'getMusicDirectory', 'startScan'].some((name) =>
          url.pathname.endsWith(name),
        ),
      ),
    ).toHaveLength(0);
    const cursor = response.json().nextCursor as string;
    expect(
      (await c.get(`/api/v1/metadata-changes?cursor=${encodeURIComponent(cursor)}`)).statusCode,
    ).toBe(200);
    c.metadata.policy.libraries[0]!.editors = [];
    expect(
      (await c.get(`/api/v1/metadata-changes?cursor=${encodeURIComponent(cursor)}`)).statusCode,
    ).toBe(400);
  });
  /** Raw uploads preserve global JSON limits and require a current cookie identity and CSRF. */
  it('should validate, scope and replay a real cover upload and bind embedded previews to the revision', async () => {
    const c = await makeSUT();
    const snapshot = (await c.get()).json();
    const front = snapshot.coverFrames.find(
      (frame: { pictureType: number }) => frame.pictureType === 3,
    );
    const original = await c.get(front.previewUrl);
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload).toEqual(readFileSync(join(c.root, 'old.png')));
    const headers = {
      ...c.headers,
      'content-type': 'image/png',
      'x-operation-id': operationId(5),
      'x-metadata-library-id': 'music',
    };
    const upload = (payload = readFileSync(join(c.root, 'new.png')), supplied = headers) =>
      c.app.inject({ method: 'POST', url: '/api/v1/metadata-covers', headers: supplied, payload });
    expect(
      (await upload(undefined, { ...headers, origin: 'https://foreign.invalid' })).statusCode,
    ).toBe(403);
    const created = await upload();
    expect(created.statusCode).toBe(201);
    expect((await upload()).json()).toEqual(created.json());
    expect((await upload(readFileSync(join(c.root, 'old.png')))).statusCode).toBe(409);
    expect((await c.get(created.json().previewUrl)).rawPayload).toEqual(
      readFileSync(join(c.root, 'new.png')),
    );
    expect(
      (
        await c.post('metadata-previews', {
          targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
          patch: { cover: { op: 'replaceAll', uploadId: created.json().uploadId } },
        })
      ).statusCode,
    ).toBe(422);
    const other = await c.login(browserHeaders, { ...password, username: 'other-user' });
    const foreign = {
      ...c.headers,
      cookie: cookieOf(other),
      'x-csrf-token': other.json().csrfToken as string,
    };
    expect((await c.get(created.json().previewUrl, foreign)).statusCode).toBe(404);
    expect((await c.get(front.previewUrl, foreign)).statusCode).toBe(404);
    const jpeg = readFileSync(join(c.root, 'new.jpg'));
    const jpegUpload = await upload(jpeg, {
      ...headers,
      'content-type': 'image/jpeg',
      'x-operation-id': operationId(10),
    });
    expect(jpegUpload.statusCode).toBe(201);
    const normalization = await c.post('metadata-previews', {
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
      patch: { cover: { op: 'replaceAll', uploadId: jpegUpload.json().uploadId } },
    });
    expect(normalization.statusCode).toBe(200);
    expect(normalization.json().coverNormalization).toEqual({
      targets: [{ trackId: 'track-1', removedCoverCount: snapshot.coverFrames.length }],
      addedJpegDigest: createHash('sha256').update(jpeg).digest('hex'),
    });
    expect(
      (
        await c.post('metadata-previews', {
          targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
          patch: { cover: { op: 'clearAll' } },
        })
      ).json().coverNormalization,
    ).toEqual({
      targets: [{ trackId: 'track-1', removedCoverCount: snapshot.coverFrames.length }],
      addedJpegDigest: null,
    });
    const body = {
      operationId: operationId(6),
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
      patch: {
        cover: {
          op: 'set',
          selector: { kind: 'front', description: 'front' },
          uploadId: created.json().uploadId,
        },
      },
    };
    expect((await c.post('metadata-jobs', body)).statusCode).toBe(202);
    expect(
      (await c.post('metadata-jobs', { ...body, operationId: operationId(7) }, foreign)).statusCode,
    ).toBe(403);
    c.metadata.policy.libraries[0]!.editors.push('other-user');
    expect(
      (await c.post('metadata-jobs', { ...body, operationId: operationId(7) }, foreign)).statusCode,
    ).toBe(404);
    expect(
      (await upload(Buffer.from('not an image'), { ...headers, 'x-operation-id': operationId(8) }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await upload(Buffer.alloc(8 * 1024 * 1024 + 1), {
          ...headers,
          'x-operation-id': operationId(9),
        })
      ).statusCode,
    ).toBe(413);
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/session',
          headers: browserHeaders,
          payload: { ...password, padding: 'x'.repeat(20000) },
        })
      ).statusCode,
    ).toBe(413);
    expect(
      (
        await c.post('metadata-previews', {
          targets: body.targets,
          patch: { trackNumber: { op: 'set', value: '13/12' } },
        })
      ).statusCode,
    ).toBe(422);
    const stored = c.storage.db.connection
      .prepare('SELECT relative_key FROM metadata_cover_uploads WHERE id=?')
      .get(created.json().uploadId)!;
    copyFileSync(join(c.root, 'old.png'), join(c.metadata.uploadRoot, String(stored.relative_key)));
    expect(
      (await c.post('metadata-previews', { targets: body.targets, patch: body.patch })).statusCode,
    ).toBe(422);
    expect(
      (
        await c.post('metadata-previews', {
          targets: body.targets,
          patch: { year: { op: 'set', value: '2025' } },
        })
      ).statusCode,
    ).toBe(422);
  });
  /** Current tags and read permissions remain usable when writes are disabled. */
  it('should read actual tags for a non-editor and reject mutation before creating a job', async () => {
    const c = await makeSUT();
    c.metadata.policy.libraries[0]!.editors = [];
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      editable: false,
      reason: 'read_only',
      values: { title: 'Original synthetic' },
    });
    const submitted = await c.post('metadata-jobs', {
      operationId: operationId(1),
      targets: [{ trackId: 'track-1', expectedRevision: response.json().fileRevision }],
      patch: { title: { op: 'clear' } },
    });
    expect(submitted.statusCode).toBe(403);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()?.n,
    ).toBe(0);
  });
  /** Preview uses in-memory tag validation and submission replay precedes fresh write eligibility. */
  it('should preview without candidates and replay an accepted request across worker unavailability', async () => {
    const c = await makeSUT();
    const snapshot = await c.get();
    expect(snapshot.statusCode).toBe(200);
    const intent = {
      targets: [{ trackId: 'track-1', expectedRevision: snapshot.json().fileRevision }],
      patch: { title: { op: 'set', value: 'Corrected synthetic' } },
    };
    const before = readFileSync(join(c.root, 'source.mp3'));
    const files = readdirSync(c.root);
    expect((await c.post('metadata-previews', intent)).statusCode).toBe(200);
    expect(readdirSync(c.root)).toEqual(files);
    expect(readFileSync(join(c.root, 'source.mp3'))).toEqual(before);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()?.n,
    ).toBe(0);
    const body = { ...intent, operationId: operationId(2) };
    const accepted = await c.post('metadata-jobs', body);
    expect(accepted.statusCode).toBe(202);
    c.unavailable();
    expect((await c.post('metadata-jobs', body)).json()).toEqual(accepted.json());
    expect(
      (await c.post('metadata-jobs', { ...body, patch: { title: { op: 'clear' } } })).statusCode,
    ).toBe(409);
    const capabilities = (await c.get('/api/v1/capabilities')).json();
    expect(capabilities.features['metadata.write']).toMatchObject({
      supported: true,
      availability: 'temporarily_unavailable',
      formats: ['mp3'],
    });
    expect(capabilities.features['metadata.curation'].supported).toBe(false);
  });
});

/** A job owner can review the original intent after a reload without exposing it anonymously. */
it('should return an authenticated original retry intent and advertised bulk scalar fields', async () => {
  const c = await makeSUT();
  const snapshot = (await c.get()).json();
  const patch = { year: { op: 'set', value: '2028' }, album: { op: 'clear' } };
  const accepted = await c.post('metadata-jobs', {
    operationId: operationId(90),
    targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
    patch,
  });
  expect(accepted.statusCode, accepted.body).toBe(202);
  const job = accepted.json().job;
  const url = `/api/v1/metadata-jobs/${job.id}/items/${job.items[0].itemId}/intent`;
  const intent = await c.get(url);
  expect(intent.statusCode).toBe(200);
  expect(intent.json()).toEqual({
    targets: [{ trackId: 'track-1', expectedRevision: snapshot.fileRevision }],
    patch,
  });
  expect((await c.app.inject({ url })).statusCode).toBe(401);
  expect((await c.get(url.replace(job.items[0].itemId, 'unknown'))).statusCode).toBe(404);
  const capability = (await c.get('/api/v1/capabilities')).json().features['metadata.write'];
  expect(capability.bulkFields).toEqual([
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'year',
    'genre',
  ]);
});
