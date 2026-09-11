import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import { browserHeaders, cookieOf, password } from '../../../tests/support/auth-harness.js';
import { createRecentContext, recentNow } from '../../../tests/support/recent-harness.js';
import { createApp } from '../src/app.js';
import { createSessionService } from '../src/auth/session-service.js';
import { verifyAccessTokenPrincipal } from '../src/auth/metadata-principal.js';

const toolchain = join(homedir(), '.cache/musiclatte-toolchain');
const helper = {
  python: join(toolchain, 'metadata-python/bin/python'),
  ffmpeg: join(toolchain, 'ffmpeg-9.0.1/ffmpeg'),
  ffprobe: join(toolchain, 'ffmpeg-9.0.1/ffprobe'),
  helperPath: resolve('apps/api/helpers/metadata.py'),
  timeoutMs: 60000,
  maxFileBytes: 10 * 1024 * 1024,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup({
  sourceAccountDirectory = 'account',
  actorAccountDirectory = 'account',
}: {
  sourceAccountDirectory?: string;
  actorAccountDirectory?: string;
} = {}) {
  const c = await createRecentContext();
  const fixtureRoot = join(c.musicRoot, 'imports', sourceAccountDirectory, 'Legacy');
  mkdirSync(fixtureRoot, { recursive: true });
  await createMetadataFixture({ root: fixtureRoot, ...helper, version: 4 });
  const trackId = 'organization-track';
  c.songs.push({
    id: trackId,
    title: 'Original synthetic',
    artist: 'Original artist',
    album: 'Original album',
    isDir: false,
    path: `imports/${sourceAccountDirectory}/Legacy/source.mp3`,
  });
  const uploadRoot = join(realpathSync(c.storage.root), 'organization-uploads');
  mkdirSync(uploadRoot, { mode: 0o700 });
  const policy = {
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
    restoreManagers: [],
    limits: { maxTargets: 1, maxFileBytes: helper.maxFileBytes, timeoutMs: 60000 },
  };
  const metadata = {
    database: c.storage.db,
    clock: () => recentNow,
    runtime: { ...helper, musicRoot: c.musicRoot },
    uploadRoot,
    workerReady: () => true,
    verifiedProfile: true,
    policy,
  };
  const automation = {
    database: c.storage.db,
    vault: c.storage.vault,
    clock: () => recentNow,
    policy,
    maxTokenAgeMs: 86400000,
    organization: {
      policy: {
        policyVersion: 'id3-managed-v1' as const,
        accounts: [
          { username: password.username, accountDirectory: actorAccountDirectory },
          ...(sourceAccountDirectory === actorAccountDirectory
            ? []
            : [{ username: 'source-owner', accountDirectory: sourceAccountDirectory }]),
        ],
      },
      ready: () => true,
    },
  };
  const options = { ...c.options, metadata, automation };
  const app = createApp(options);
  const login = await c.login();
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/access-tokens',
    headers: {
      ...browserHeaders,
      cookie: cookieOf(login),
      'x-csrf-token': login.json().csrfToken,
    },
    payload: {
      name: 'Organization test',
      scopes: ['metadata:read', 'metadata:write', 'media:organize'],
      libraryIds: ['music'],
      expiresAt: recentNow + 60000,
    },
  });
  expect(created.statusCode).toBe(201);
  const token = String(created.json().token);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const snapshot = await app.inject({
    url: `/api/v1/tracks/${trackId}/metadata`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(snapshot.statusCode).toBe(200);
  const revision = String(snapshot.json().fileRevision);
  const principal = await verifyAccessTokenPrincipal(createSessionService(options), token, [
    'metadata:read',
    'metadata:write',
    'media:organize',
  ]);
  const media = c.storage.db.connection
    .prepare('SELECT id FROM media_links WHERE library_id=? AND gonic_song_id=?')
    .get('music', trackId)!;
  c.storage.db.connection
    .prepare(
      "INSERT INTO metadata_jobs(id,identity_key,library_id,operation_id_hash,request_hash,kind,created_at) VALUES('completed-metadata',?,'music',?,?,'edit',?)",
    )
    .run(principal.actorIdentityKey, 'a'.repeat(64), 'b'.repeat(64), recentNow);
  c.storage.db.connection
    .prepare(
      'INSERT INTO metadata_items(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_token_id,policy_revision,stage,generation,stage_changed_at,file_saved_at,reflected_at,result_revision,result_digest,changed_fields_json,next_reflection_at) VALUES(\'completed-item\',\'completed-metadata\',0,?,?,1,?,?,?,?,\'{"title":{"op":"set","value":"Original synthetic"}}\',?,1,\'succeeded\',1,?,?,?,?,?,\'["title"]\',0)',
    )
    .run(
      String(media.id),
      'f'.repeat(64),
      trackId,
      trackId,
      revision,
      'd'.repeat(64),
      principal.accessToken.id,
      recentNow,
      recentNow,
      recentNow,
      revision,
      'd'.repeat(64),
    );
  cleanups.push(async () => {
    await app.close();
    await c.cleanup();
  });
  return { c, app, token, headers, trackId, revision, login };
}

describe('metadata organization PAT API', () => {
  /** A scoped PAT may organize a shared song without changing its source account directory. */
  it('should keep a configured source account when another account submits the organization', async () => {
    const s = await setup({
      sourceAccountDirectory: 'admin',
      actorAccountDirectory: 'yellowgg2',
    });
    const previewBody = {
      trackId: s.trackId,
      expectedRevision: s.revision,
      destinationPolicy: 'id3-managed-v1',
    };
    const preview = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/previews',
      headers: s.headers,
      payload: previewBody,
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      status: 'ready',
      currentKey: 'imports/admin/Legacy/source.mp3',
      targetKey:
        'imports/admin/ID3-managed/Original album artist/Original album/01 - Original synthetic.mp3',
    });
    const submit = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        ...previewBody,
        operationId: 'shared_source_account_operation_0001',
        metadataJobId: 'completed-metadata',
        sourceEvidence: [
          {
            url: 'https://example.invalid/official',
            kind: 'official_artist',
            fields: ['title'],
          },
        ],
      },
    });
    expect(submit.statusCode).toBe(202);
  });

  it('runs strict preview, submit, replay, owner status, and recovery retry', async () => {
    const s = await setup();
    const candidates = await s.app.inject({
      url: '/api/v1/metadata-organization/candidates?title=Original&limit=1',
      headers: { authorization: `Bearer ${s.token}` },
    });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json()).toEqual({
      schemaVersion: 1,
      total: 1,
      candidates: [
        {
          trackId: s.trackId,
          libraryId: 'music',
          title: 'Original synthetic',
          artist: ['Original artist'],
          album: 'Original album',
          currentRevision: s.revision,
          importSourceId: null,
        },
      ],
    });
    const previewBody = {
      trackId: s.trackId,
      expectedRevision: s.revision,
      destinationPolicy: 'id3-managed-v1',
    };
    const preview = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/previews',
      headers: s.headers,
      payload: previewBody,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: 'ready', writeGuaranteed: false });
    const body = {
      ...previewBody,
      operationId: 'organization_operation_0001',
      metadataJobId: 'completed-metadata',
      sourceEvidence: [
        {
          url: 'https://example.invalid/official',
          kind: 'official_artist',
          fields: ['title'],
        },
      ],
    };
    const submit = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: body,
    });
    expect(submit.statusCode).toBe(202);
    expect(submit.body).not.toContain('Legacy/source.mp3');
    expect(submit.body).not.toContain('example.invalid');
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization-jobs',
          headers: s.headers,
          payload: body,
        })
      ).json(),
    ).toEqual(submit.json());
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization-jobs',
          headers: s.headers,
          payload: {
            ...body,
            sourceEvidence: [
              {
                ...body.sourceEvidence[0],
                url: 'https://example.invalid/different',
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(409);
    const job = submit.json().job;
    expect(
      (
        await s.app.inject({
          url: `/api/v1/metadata-organization-jobs/${job.id}`,
          headers: { authorization: `Bearer ${s.token}` },
        })
      ).json(),
    ).toEqual(submit.json());
    s.c.storage.db.connection
      .prepare(
        "UPDATE organization_items SET stage='recovery_required',error_code='worker_interrupted',next_owner='filesystem',lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
      )
      .run(job.itemId);
    const retryBody = { operationId: 'organization_retry_00001' };
    const retry = await s.app.inject({
      method: 'POST',
      url: `/api/v1/metadata-organization-jobs/${job.id}/retries`,
      headers: s.headers,
      payload: retryBody,
    });
    expect(retry.statusCode).toBe(202);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization-jobs/${job.id}/retries`,
          headers: s.headers,
          payload: retryBody,
        })
      ).json(),
    ).toEqual(retry.json());
    expect(
      s.c.storage.db.connection
        .prepare("SELECT count(*) AS count FROM organization_events WHERE kind='retry_requested'")
        .get()!.count,
    ).toBe(1);
    s.c.storage.db.connection
      .prepare(
        "UPDATE organization_items SET stage='moving',error_code=NULL,next_owner=NULL,lease_owner='recovery-worker',lease_expires_at=? WHERE id=?",
      )
      .run(Date.now() + 30_000, job.itemId);
    const raced = await s.app.inject({
      method: 'POST',
      url: `/api/v1/metadata-organization-jobs/${job.id}/retries`,
      headers: s.headers,
      payload: { operationId: 'organization_retry_raced_00002' },
    });
    expect(raced.statusCode).toBe(202);
    expect(raced.json().job.stage).toBe('moving');
    expect(
      s.c.storage.db.connection
        .prepare("SELECT count(*) AS count FROM organization_events WHERE kind='retry_requested'")
        .get()!.count,
    ).toBe(1);
  });

  it('admits an album-only reflection mismatch so the managed move can repair the directory projection', async () => {
    const s = await setup();
    s.c.storage.db.connection
      .prepare(
        "UPDATE metadata_items SET stage='reflecting',error_code='reflection_mismatch',changed_fields_json='[\"album\"]' WHERE id='completed-item'",
      )
      .run();
    s.c.storage.db.connection
      .prepare(
        'INSERT INTO metadata_item_evidence(item_id,references_json,reflection_json,updated_at) VALUES(?,?,?,?)',
      )
      .run(
        'completed-item',
        JSON.stringify({ trackId: s.trackId, starred: false, playlists: [] }),
        JSON.stringify({
          fileVerifiedFields: ['album'],
          indexVerifiedFields: ['title', 'artist', 'trackNumber', 'year', 'genre', 'cover'],
          unsupportedProjection: ['albumArtist', 'lyrics'],
          mismatched: ['album'],
        }),
        recentNow,
      );
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        trackId: s.trackId,
        expectedRevision: s.revision,
        destinationPolicy: 'id3-managed-v1',
        operationId: 'organization_album_projection_0001',
        metadataJobId: 'completed-metadata',
        sourceEvidence: [
          {
            url: 'https://example.invalid/official',
            kind: 'official_artist',
            fields: ['album'],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(202);
  });

  it('rejects other reflection mismatches before organization admission', async () => {
    const s = await setup();
    s.c.storage.db.connection
      .prepare(
        "UPDATE metadata_items SET stage='reflecting',error_code='reflection_mismatch',changed_fields_json='[\"cover\"]' WHERE id='completed-item'",
      )
      .run();
    s.c.storage.db.connection
      .prepare(
        'INSERT INTO metadata_item_evidence(item_id,references_json,reflection_json,updated_at) VALUES(?,?,?,?)',
      )
      .run(
        'completed-item',
        JSON.stringify({ trackId: s.trackId, starred: false, playlists: [] }),
        JSON.stringify({
          fileVerifiedFields: ['cover'],
          indexVerifiedFields: ['title', 'artist', 'album', 'trackNumber', 'year', 'genre'],
          unsupportedProjection: ['albumArtist', 'lyrics'],
          mismatched: ['cover'],
        }),
        recentNow,
      );
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        trackId: s.trackId,
        expectedRevision: s.revision,
        destinationPolicy: 'id3-managed-v1',
        operationId: 'organization_cover_projection_0001',
        metadataJobId: 'completed-metadata',
        sourceEvidence: [
          {
            url: 'https://example.invalid/official',
            kind: 'official_artist',
            fields: ['cover'],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects sessions, query tokens, missing scope, and conflicting replay before admission', async () => {
    const s = await setup();
    const payload = {
      trackId: s.trackId,
      expectedRevision: s.revision,
      destinationPolicy: 'id3-managed-v1',
    };
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/previews',
          headers: { ...browserHeaders, cookie: cookieOf(s.login) },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization/previews?token=${encodeURIComponent(s.token)}`,
          headers: s.headers,
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const limited = await s.app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {
        name: 'Limited',
        scopes: ['metadata:read'],
        libraryIds: ['music'],
        expiresAt: recentNow + 60000,
      },
    });
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/previews',
          headers: {
            authorization: `Bearer ${limited.json().token}`,
            'content-type': 'application/json',
          },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      s.c.storage.db.connection.prepare('SELECT count(*) AS count FROM organization_jobs').get()!
        .count,
    ).toBe(0);
    const contradictory = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        ...payload,
        operationId: 'organization_operation_0002',
        metadataJobId: 'completed-metadata',
        sourceEvidence: [
          {
            url: 'https://example.invalid/official',
            kind: 'official_artist',
            fields: ['cover'],
          },
        ],
      },
    });
    expect(contradictory.statusCode).toBe(422);
    expect(
      s.c.storage.db.connection.prepare('SELECT count(*) AS count FROM organization_jobs').get()!
        .count,
    ).toBe(0);
  });
});
