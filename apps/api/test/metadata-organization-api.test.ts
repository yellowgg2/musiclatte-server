import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import { browserHeaders, cookieOf, native, password } from '../../../tests/support/auth-harness.js';
import { createRecentContext, recentNow } from '../../../tests/support/recent-harness.js';
import { createApp } from '../src/app.js';
import { createSessionService } from '../src/auth/session-service.js';
import { verifyAccessTokenPrincipal } from '../src/auth/metadata-principal.js';
import { createOrganizationRepository } from '../src/storage/organization-repository.js';
import { createCurationRepository } from '../src/storage/curation-repository.js';
import { decodeMetadataChanges } from '../../../packages/contracts/src/metadata.js';

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
    curation: {
      limits: {
        claimLeaseMs: 1000,
        maxTargets: 10,
        snapshotMaxAgeMs: 60_000,
        snapshotMaxItems: 1000,
        snapshotMaxCount: 10,
      },
      ready: () => true,
    },
    organization: {
      policy: {
        policyVersion: 'id3-managed-v1' as const,
        selection: {
          snapshotMaxAgeMs: 60_000,
          snapshotMaxItems: 10_000,
          snapshotMaxCount: 10,
        },
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
      scopes: ['metadata:read', 'metadata:write', 'media:organize', 'collections:read'],
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
  const curation = createCurationRepository({
    database: c.storage.db,
    clock: () => recentNow,
    cursorKey: options.signingKey,
    limits: automation.curation.limits,
  });
  const trackRef = curation.discover({
    libraryId: 'music',
    trackId,
    format: 'mp3',
    mediaLinkId: String(media.id),
    fileIdentity: 'f'.repeat(64),
    bindingRevision: 1,
  });
  curation.observe(trackRef, {
    revision,
    requiredFingerprint: 'required',
    audioIdentity: 'audio',
    policyVersion: 'required-v1',
    trusted: true,
    title: 'Original synthetic',
    artist: ['Original artist'],
    album: 'Original album',
    fields: {
      title: true,
      artist: true,
      album: true,
      albumArtist: true,
      trackNumber: true,
      year: false,
      genre: false,
      cover: false,
      lyrics: false,
    },
    changedFields: [],
  });
  c.storage.db.connection
    .prepare(
      "INSERT INTO curation_inventory_runs(library_id,generation,status,last_discovery_at,last_reconciled_at,event_sequence,checkpoint_json) VALUES('music','generation-1','ready',?,?,0,'{\"discoveryComplete\":true}')",
    )
    .run(recentNow, recentNow);
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
  return {
    c,
    app,
    token,
    accessTokenId: String(created.json().accessToken.id),
    headers,
    trackId,
    revision,
    login,
    curation,
    actorIdentityKey: principal.actorIdentityKey,
  };
}

describe('metadata organization PAT API', () => {
  /** Whole-library selection is an explicit PAT-only endpoint, separate from collection selection. */
  it('should expose the unorganized selection endpoint', async () => {
    const s = await setup();
    const db = s.c.storage.db.connection;
    for (let index = 0; index < 100; index++) {
      const mediaLinkId = `selection-media-${index}`;
      const trackId = `selection-track-${String(index).padStart(3, '0')}`;
      db.prepare(
        "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES(?,'music',?,?,1,'available',?)",
      ).run(mediaLinkId, `imports/account/selection-${index}.mp3`, trackId, recentNow);
      db.prepare(
        "INSERT INTO curation_tracks(id,library_id,track_id,media_link_id,binding_revision,format,title,artist_json,album,base_status,policy_version,validation) VALUES(?,'music',?,?,1,'mp3',?,'[\"Selection artist\"]','Selection album','unreviewed','required-v1','verified')",
      ).run(`selection-ref-${index}`, trackId, mediaLinkId, `Selection ${index}`);
    }
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/unorganized-selections',
      headers: s.headers,
      payload: { schemaVersion: 1 },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      completeCoverage: true,
      summary: {
        total: 101,
        organized: 0,
        needsOrganization: 101,
        processing: 0,
        attention: 0,
        unknown: 0,
      },
    });
    expect(response.json().items).toHaveLength(100);
    expect(response.json().nextCursor).toBeTypeOf('string');
    expect(response.body).not.toMatch(/source\.mp3|relativeFileKey|actor|token|path/i);

    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('selection-active-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run(s.actorIdentityKey, 'c'.repeat(64), 'd'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('selection-active-item','selection-active-job','selection-media-99','imports/account/selection-99.mp3','imports/account/ID3-managed/selection-99.mp3','selection-track-099',?,?,'queued',?)",
    ).run('e'.repeat(64), 'f'.repeat(64), recentNow);
    const live = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: s.headers,
      payload: {
        schemaVersion: 1,
        targets: [{ kind: 'media_link', mediaLinkId: 'selection-media-99' }],
      },
    });
    expect(live.json().items[0]).toMatchObject({ state: 'processing', stage: 'queued' });

    const next = await s.app.inject({
      method: 'GET',
      url: `/api/v1/metadata-organization/unorganized-selections/${response.json().selectionId}/pages?cursor=${encodeURIComponent(response.json().nextCursor)}`,
      headers: { authorization: `Bearer ${s.token}` },
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json().items).toHaveLength(1);
    expect(next.json().items[0].mediaLinkId).toBe('selection-media-99');
    expect(next.json().nextCursor).toBeNull();
    expect([...response.json().items, ...next.json().items]).toHaveLength(101);

    const tampered = await s.app.inject({
      method: 'GET',
      url: `/api/v1/metadata-organization/unorganized-selections/${response.json().selectionId}/pages?cursor=${encodeURIComponent(response.json().nextCursor + 'x')}`,
      headers: { authorization: `Bearer ${s.token}` },
    });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json().error.code).toBe('invalid_request');

    const foreign = await s.app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {
        name: 'Other selection token',
        scopes: ['metadata:read', 'metadata:write', 'media:organize'],
        libraryIds: ['music'],
        expiresAt: recentNow + 60000,
      },
    });
    const foreignPage = await s.app.inject({
      method: 'GET',
      url: `/api/v1/metadata-organization/unorganized-selections/${response.json().selectionId}/pages?cursor=${encodeURIComponent(response.json().nextCursor)}`,
      headers: { authorization: `Bearer ${foreign.json().token}` },
    });
    expect(foreignPage.statusCode).toBe(409);
    expect(foreignPage.json().error.code).toBe('snapshot_scope_changed');
  });

  /** Selection requires explicit current-principal PAT authority and complete inventory coverage. */
  it('should reject selectors, browser sessions, missing scope, and incomplete inventory', async () => {
    const s = await setup();
    const endpoint = '/api/v1/metadata-organization/unorganized-selections';
    for (const payload of [
      { schemaVersion: 1, libraryId: 'music' },
      { schemaVersion: 1, username: password.username },
      { schemaVersion: 1, filter: 'needs' },
    ]) {
      const response = await s.app.inject({
        method: 'POST',
        url: endpoint,
        headers: s.headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: endpoint,
          headers: {
            ...browserHeaders,
            cookie: cookieOf(s.login),
            'x-csrf-token': s.login.json().csrfToken,
          },
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(403);
    const limited = await s.app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {
        name: 'Selection read only',
        scopes: ['metadata:read'],
        libraryIds: ['music'],
        expiresAt: recentNow + 60000,
      },
    });
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: endpoint,
          headers: {
            authorization: `Bearer ${limited.json().token}`,
            'content-type': 'application/json',
          },
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(403);
    s.c.storage.db.connection
      .prepare(
        "UPDATE curation_inventory_runs SET status='partial',last_error_code='inventory_pending' WHERE library_id='music'",
      )
      .run();
    const incomplete = await s.app.inject({
      method: 'POST',
      url: endpoint,
      headers: s.headers,
      payload: { schemaVersion: 1 },
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().error.code).toBe('inventory_incomplete');
    expect(incomplete.json().error.details).toEqual({
      libraries: [{ libraryId: 'music', status: 'partial' }],
    });
    expect(
      s.c.storage.db.connection
        .prepare('SELECT count(*) AS n FROM organization_selection_snapshots')
        .get()!.n,
    ).toBe(0);
  });

  /** The status read is the only organization endpoint shared by browser sessions and read PATs. */
  it('should return the same scoped ordered statuses for cookie and PAT principals', async () => {
    const s = await setup();
    const db = s.c.storage.db.connection;
    const mediaLinkId = String(
      db
        .prepare('SELECT id FROM media_links WHERE library_id=? AND gonic_song_id=?')
        .get('music', s.trackId)!.id,
    );
    const relativeFileKey = String(
      db.prepare('SELECT relative_file_key FROM media_links WHERE id=?').get(mediaLinkId)!
        .relative_file_key,
    );
    db.prepare(
      "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES('completed-item',?,?, 'music','old','new','{}','cover','[\"title\"]','verified',?)",
    ).run(mediaLinkId, s.actorIdentityKey, recentNow);
    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('legacy-status-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run(s.actorIdentityKey, 'c'.repeat(64), 'd'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('legacy-status-item','legacy-status-job',?,?,?,?,?,?,?,'succeeded',?)",
    ).run(
      mediaLinkId,
      relativeFileKey,
      relativeFileKey,
      s.trackId,
      s.trackId,
      'e'.repeat(64),
      'f'.repeat(64),
      recentNow,
    );
    const payload = {
      schemaVersion: 1,
      targets: [
        { kind: 'track', trackId: s.trackId },
        { kind: 'media_link', mediaLinkId },
        { kind: 'track', trackId: 'outside-or-missing' },
      ],
    };
    const pat = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: s.headers,
      payload,
    });
    const cookie = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload,
    });

    expect(pat.statusCode, pat.body).toBe(200);
    expect(cookie.statusCode, cookie.body).toBe(200);
    expect(cookie.json()).toEqual(pat.json());
    expect(pat.json()).toEqual({
      schemaVersion: 1,
      capturedAt: recentNow,
      items: [
        {
          target: payload.targets[0],
          state: 'organized',
          reason: 'verified',
          stage: 'succeeded',
          changedAt: recentNow,
        },
        {
          target: payload.targets[1],
          state: 'organized',
          reason: 'verified',
          stage: 'succeeded',
          changedAt: recentNow,
        },
        {
          target: payload.targets[2],
          state: 'unknown',
          reason: 'identity_unavailable',
          stage: null,
          changedAt: null,
        },
      ],
    });
    expect(pat.body).not.toMatch(/source\.mp3|actor|operation|digest|token|errorCode/i);

    db.prepare(
      "INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES('status-import-job',?,'music',?,?,?)",
    ).run('1'.repeat(64), '2'.repeat(64), '3'.repeat(64), recentNow);
    db.prepare(
      "INSERT INTO import_items(id,job_id,item_order,source_id,stage,media_link_id,stage_changed_at,ready_at) VALUES('status-import-item','status-import-job',0,'status-source','ready',?,?,?)",
    ).run(mediaLinkId, recentNow, recentNow);
    const importedPat = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: s.headers,
      payload,
    });
    const importedCookie = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload,
    });
    expect(importedCookie.json()).toEqual(importedPat.json());
    expect(importedPat.json().items.slice(0, 2)).toEqual(
      payload.targets.slice(0, 2).map((target) => ({
        target,
        state: 'unknown',
        reason: 'verification_missing',
        stage: 'succeeded',
        changedAt: recentNow,
      })),
    );
    expect(importedPat.body).not.toMatch(
      /status-source|source\.mp3|actor|operation|digest|token|errorCode/i,
    );
  });

  /** Status auth and validation fail before projection without weakening PAT-only writes. */
  it('should enforce status credential, CSRF, JSON, scope, and bounded target rules', async () => {
    const s = await setup();
    const payload = {
      schemaVersion: 1,
      targets: [{ kind: 'track', trackId: s.trackId }],
    };
    const cookie = { ...browserHeaders, cookie: cookieOf(s.login) };
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/statuses',
          headers: cookie,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/statuses',
          headers: { ...cookie, 'x-csrf-token': 'wrong' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization/statuses?token=${encodeURIComponent(s.token)}`,
          headers: s.headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/statuses',
          headers: { authorization: `Bearer ${s.token}`, 'content-type': 'text/plain' },
          payload: JSON.stringify(payload),
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/statuses',
          headers: { 'content-type': 'application/json' },
          payload,
        })
      ).statusCode,
    ).toBe(401);

    const limited = await s.app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {
        name: 'Metadata read only',
        scopes: ['metadata:read'],
        libraryIds: ['music'],
        expiresAt: recentNow + 60000,
      },
    });
    expect(limited.statusCode).toBe(201);
    const limitedHeaders = {
      authorization: `Bearer ${limited.json().token}`,
      'content-type': 'application/json',
    };
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/statuses',
          headers: limitedHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: limitedHeaders,
          payload: { source: { kind: 'favorites' } },
        })
      ).statusCode,
    ).toBe(403);

    for (const invalid of [
      { ...payload, targets: [payload.targets[0], payload.targets[0]] },
      {
        ...payload,
        targets: Array.from({ length: 101 }, (_, index) => ({
          kind: 'track',
          trackId: `track-${index}`,
        })),
      },
      { ...payload, libraryId: 'music' },
    ]) {
      const response = await s.app.inject({
        method: 'POST',
        url: '/api/v1/metadata-organization/statuses',
        headers: s.headers,
        payload: invalid,
      });
      expect(response.statusCode, `${JSON.stringify(invalid)} ${response.body}`).toBe(400);
    }

    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/previews',
          headers: {
            ...browserHeaders,
            cookie: cookieOf(s.login),
            'x-csrf-token': s.login.json().csrfToken,
          },
          payload: {
            trackId: s.trackId,
            expectedRevision: s.revision,
            destinationPolicy: 'id3-managed-v1',
          },
        })
      ).statusCode,
    ).toBe(403);
  });

  /** The maximum batch remains one bounded read and preserves all requested positions. */
  it('should accept one hundred unknown status targets in input order', async () => {
    const s = await setup();
    const targets = Array.from({ length: 100 }, (_, index) => ({
      kind: 'track' as const,
      trackId: `missing-${index}`,
    }));
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: s.headers,
      payload: { schemaVersion: 1, targets },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().items.map((item: { target: unknown }) => item.target)).toEqual(targets);
    expect(new Set(response.json().items.map((item: { state: string }) => item.state))).toEqual(
      new Set(['unknown']),
    );
  });

  /** Storage failures keep SQLite details and private target data behind the API error envelope. */
  it('should redact status projection storage failures', async () => {
    const s = await setup();
    s.c.storage.db.connection.exec('DROP TABLE organization_items');
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/statuses',
      headers: s.headers,
      payload: {
        schemaVersion: 1,
        targets: [{ kind: 'track', trackId: s.trackId }],
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'internal_error', retryable: true },
    });
    expect(response.body).not.toMatch(/organization_items|sqlite|source\.mp3/i);
  });

  /** A scoped PAT freezes and restores only its own references for a recorded successor. */
  it('preserves duplicate playlist occurrences and a favorite across another account move', async () => {
    const s = await setup();
    s.c.state.favoriteSongIdsByUsername.set(password.username, [s.trackId]);
    s.c.state.playlistEntryIds = [s.trackId, 'tr-B', s.trackId];
    const snapshot = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-snapshots',
      headers: s.headers,
      payload: { trackId: s.trackId },
    });
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json()).toEqual({
      schemaVersion: 1,
      trackId: s.trackId,
      starred: true,
      playlists: [
        {
          id: 'pl-1',
          name: 'Synthetic List',
          owner: password.username,
          songIds: [s.trackId, 'tr-B', s.trackId],
        },
      ],
    });

    const db = s.c.storage.db.connection;
    const mediaLinkId = String(
      db.prepare("SELECT media_link_id FROM metadata_items WHERE id='completed-item'").get()!
        .media_link_id,
    );
    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('shared-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run('7'.repeat(64), '8'.repeat(64), '9'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('shared-item','shared-job',?,'imports/account/Legacy/source.mp3','imports/account/Managed/source.mp3',?,'replacement-track',?,?,'succeeded',?)",
    ).run(mediaLinkId, s.trackId, 'a'.repeat(64), 'b'.repeat(64), recentNow);
    db.prepare('UPDATE media_links SET gonic_song_id=?,revision=revision+1 WHERE id=?').run(
      'replacement-track',
      mediaLinkId,
    );
    s.c.songs.push({
      id: 'replacement-track',
      title: 'Original synthetic',
      artist: 'Original artist',
      album: 'Original album',
      isDir: false,
      path: 'imports/account/Legacy/source.mp3',
    });
    s.c.state.favoriteSongIdsByUsername.set(password.username, []);
    s.c.state.playlistEntryIds = ['tr-B'];
    const restored = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-restores',
      headers: s.headers,
      payload: {
        trackId: snapshot.json().trackId,
        newTrackId: 'replacement-track',
        starred: snapshot.json().starred,
        playlists: snapshot.json().playlists,
      },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toEqual({
      schemaVersion: 1,
      trackId: s.trackId,
      newTrackId: 'replacement-track',
      starred: true,
      playlistsRestored: 1,
    });
    expect(s.c.state.favoriteSongIdsByUsername.get(password.username)).toEqual([
      'replacement-track',
    ]);
    expect(s.c.state.playlistEntryIds).toEqual(['replacement-track', 'tr-B', 'replacement-track']);
  });

  /** An approved target replacement preserves the displaced track's account references too. */
  it('restores displaced target references through the approved successor relation', async () => {
    const s = await setup();
    const displacedTrackId = 'tr-displaced';
    const snapshot = { trackId: displacedTrackId, starred: true, playlists: [] };

    const db = s.c.storage.db.connection;
    const sourceMediaLinkId = String(
      db.prepare("SELECT media_link_id FROM metadata_items WHERE id='completed-item'").get()!
        .media_link_id,
    );
    const displacedMediaLinkId = 'displaced-media-link';
    db.prepare(
      "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES(?,'music','imports/account/Legacy/displaced.mp3',?,1,'available',?,?)",
    ).run(displacedMediaLinkId, displacedTrackId, recentNow, recentNow);
    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('replacement-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run('7'.repeat(64), '8'.repeat(64), '9'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('replacement-item','replacement-job',?,'imports/account/Legacy/source.mp3','imports/account/Managed/source.mp3',?,'replacement-track',?,?,'succeeded',?)",
    ).run(sourceMediaLinkId, s.trackId, 'a'.repeat(64), 'b'.repeat(64), recentNow);
    db.prepare(
      "INSERT INTO organization_target_replacements(item_id,displaced_media_link_id,displaced_track_id,operation_id_hash,request_hash,backup_receipt_digest,reference_snapshot_digests_json,created_at) VALUES('replacement-item',?,?,?,?,?,?,?)",
    ).run(
      displacedMediaLinkId,
      displacedTrackId,
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      JSON.stringify(['f'.repeat(64)]),
      recentNow,
    );
    db.prepare('UPDATE media_links SET gonic_song_id=?,revision=revision+1 WHERE id=?').run(
      'replacement-track',
      sourceMediaLinkId,
    );
    s.c.songs.push({
      id: 'replacement-track',
      title: 'Original synthetic',
      artist: 'Original artist',
      album: 'Original album',
      isDir: false,
      path: 'imports/account/Legacy/source.mp3',
    });
    s.c.state.favoriteSongIdsByUsername.set(password.username, []);

    const restored = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-restores',
      headers: s.headers,
      payload: {
        trackId: displacedTrackId,
        newTrackId: 'replacement-track',
        starred: snapshot.starred,
        playlists: snapshot.playlists,
      },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({
      trackId: displacedTrackId,
      newTrackId: 'replacement-track',
      starred: true,
    });
    expect(s.c.state.favoriteSongIdsByUsername.get(password.username)).toEqual([
      'replacement-track',
    ]);
  });

  /** A replacement restores both predecessor occurrences when gonic collapses them to one ID. */
  it('restores overlapping source and displaced playlist references after replacement', async () => {
    const s = await setup();
    const displacedTrackId = 'tr-displaced';
    const replacementTrackId = 'replacement-track';
    const db = s.c.storage.db.connection;
    const sourceMediaLinkId = String(
      db.prepare("SELECT media_link_id FROM metadata_items WHERE id='completed-item'").get()!
        .media_link_id,
    );
    const displacedMediaLinkId = 'displaced-media-link';
    db.prepare(
      "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES(?,'music','imports/account/Legacy/displaced.mp3',?,1,'available',?,?)",
    ).run(displacedMediaLinkId, displacedTrackId, recentNow, recentNow);
    s.c.songs.push({
      id: displacedTrackId,
      title: 'Displaced synthetic',
      artist: 'Original artist',
      album: 'Original album',
      isDir: false,
      path: 'imports/account/Legacy/displaced.mp3',
    });
    s.c.state.favoriteSongIdsByUsername.set(password.username, [displacedTrackId]);
    s.c.state.playlistEntryIds = [s.trackId, displacedTrackId];

    const playlists = [
      {
        id: 'pl-1',
        name: 'Synthetic List',
        owner: password.username,
        songIds: [s.trackId, displacedTrackId],
      },
    ];
    const sourceSnapshot = { trackId: s.trackId, starred: false, playlists };
    const displacedSnapshot = { trackId: displacedTrackId, starred: true, playlists };

    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('replacement-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run('7'.repeat(64), '8'.repeat(64), '9'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('replacement-item','replacement-job',?,'imports/account/Legacy/source.mp3','imports/account/Managed/source.mp3',?,?,?,?,'succeeded',?)",
    ).run(
      sourceMediaLinkId,
      s.trackId,
      replacementTrackId,
      'a'.repeat(64),
      'b'.repeat(64),
      recentNow,
    );
    db.prepare(
      "INSERT INTO organization_target_replacements(item_id,displaced_media_link_id,displaced_track_id,operation_id_hash,request_hash,backup_receipt_digest,reference_snapshot_digests_json,created_at) VALUES('replacement-item',?,?,?,?,?,?,?)",
    ).run(
      displacedMediaLinkId,
      displacedTrackId,
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      JSON.stringify(['f'.repeat(64)]),
      recentNow,
    );
    db.prepare('UPDATE media_links SET gonic_song_id=?,revision=revision+1 WHERE id=?').run(
      replacementTrackId,
      sourceMediaLinkId,
    );
    s.c.songs.push({
      id: replacementTrackId,
      title: 'Original synthetic',
      artist: 'Original artist',
      album: 'Original album',
      isDir: false,
      path: 'imports/account/Legacy/source.mp3',
    });
    s.c.state.favoriteSongIdsByUsername.set(password.username, []);
    s.c.state.playlistEntryIds = [replacementTrackId];

    const sourceRestored = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-restores',
      headers: s.headers,
      payload: {
        trackId: sourceSnapshot.trackId,
        newTrackId: replacementTrackId,
        starred: sourceSnapshot.starred,
        playlists: sourceSnapshot.playlists,
      },
    });
    expect(sourceRestored.statusCode, sourceRestored.body).toBe(200);
    expect(s.c.state.playlistEntryIds).toEqual([replacementTrackId, replacementTrackId]);

    const displacedRestored = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-restores',
      headers: s.headers,
      payload: {
        trackId: displacedSnapshot.trackId,
        newTrackId: replacementTrackId,
        starred: displacedSnapshot.starred,
        playlists: displacedSnapshot.playlists,
      },
    });
    expect(displacedRestored.statusCode, displacedRestored.body).toBe(200);
    expect(s.c.state.favoriteSongIdsByUsername.get(password.username)).toEqual([
      replacementTrackId,
    ]);
    expect(s.c.state.playlistEntryIds).toEqual([replacementTrackId, replacementTrackId]);
  });

  /** Restore cannot mutate collections without an exact successful organization relation. */
  it('rejects an unrecorded successor without collection writes', async () => {
    const s = await setup();
    const response = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/reference-restores',
      headers: s.headers,
      payload: {
        trackId: s.trackId,
        newTrackId: 'unrecorded',
        starred: true,
        playlists: [],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(s.c.state.favoriteWriteObserved).toBe(false);
    expect(s.c.state.mutationWriteCount).toBe(0);
  });

  /** PAT collection reads freeze favorites and owned playlist duplicates without creating jobs. */
  it('should select favorites and an owned playlist as private frozen snapshots', async () => {
    const s = await setup();
    s.c.state.favoriteSongIdsByUsername.set(password.username, ['fav-A', 'fav-B']);
    const favorites = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/selections',
      headers: s.headers,
      payload: { source: { kind: 'favorites' } },
    });
    expect(favorites.statusCode, favorites.body).toBe(200);
    expect(favorites.json()).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'favorites' },
      occurrenceCount: 2,
      uniqueTrackCount: 2,
      items: [
        { trackId: 'fav-A', occurrenceIndexes: [0] },
        { trackId: 'fav-B', occurrenceIndexes: [1] },
      ],
    });
    const playlist = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/selections',
      headers: s.headers,
      payload: { source: { kind: 'playlist', playlistId: 'pl-1' } },
    });
    expect(playlist.statusCode).toBe(200);
    expect(playlist.json()).toMatchObject({
      source: { kind: 'playlist', playlistId: 'pl-1', name: 'Synthetic List' },
      occurrenceCount: 3,
      uniqueTrackCount: 2,
      items: [
        { trackId: 'tr-A', occurrenceIndexes: [0, 2] },
        { trackId: 'tr-B', occurrenceIndexes: [1] },
      ],
    });
    expect(playlist.json().selectionRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(playlist.body).not.toMatch(/path|proof|token|synthetic-secret/i);
    s.c.state.emptyCollections = true;
    const empty = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/selections',
      headers: s.headers,
      payload: { source: { kind: 'favorites' } },
    });
    expect(empty.json()).toMatchObject({ occurrenceCount: 0, uniqueTrackCount: 0, items: [] });
    s.c.state.emptyCollections = false;
    expect(s.c.requests.filter((request) => request.pathname === '/rest/getStarred2')).toHaveLength(
      2,
    );
    expect(s.c.requests.filter((request) => request.pathname === '/rest/getPlaylist')).toHaveLength(
      1,
    );
    expect(
      s.c.storage.db.connection.prepare('SELECT count(*) AS count FROM organization_jobs').get()!
        .count,
    ).toBe(0);
    expect(s.c.state.mutationWriteCount).toBe(0);
  });

  /** Foreign ownership, missing scope, oversized input and post-read revocation fail closed. */
  it('should reject unsafe collection selections after the exact upstream read', async () => {
    const s = await setup();
    s.c.state.playlistOwner = 'foreign-owner';
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: s.headers,
          payload: { source: { kind: 'playlist', playlistId: 'pl-1' } },
        })
      ).statusCode,
    ).toBe(404);
    s.c.state.playlistOwner = password.username;
    s.c.state.playlistEntryIds = Array.from({ length: 1001 }, (_, index) => `track-${index}`);
    const oversized = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/selections',
      headers: s.headers,
      payload: { source: { kind: 'playlist', playlistId: 'pl-1' } },
    });
    expect(oversized.statusCode).toBe(422);
    expect(oversized.json().error.code).toBe('selection_too_large');
    const limited = await s.app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {
        name: 'No collection scope',
        scopes: ['metadata:read'],
        libraryIds: ['music'],
        expiresAt: recentNow + 60000,
      },
    });
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: {
            authorization: `Bearer ${limited.json().token}`,
            'content-type': 'application/json',
          },
          payload: { source: { kind: 'favorites' } },
        })
      ).statusCode,
    ).toBe(403);
    let release!: () => void;
    s.c.state.collectionResponseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.c.state.playlistEntryIds = ['tr-A'];
    const pending = s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/selections',
      headers: s.headers,
      payload: { source: { kind: 'playlist', playlistId: 'pl-1' } },
    });
    await expect
      .poll(() => s.c.requests.filter((request) => request.pathname === '/rest/getPlaylist').length)
      .toBeGreaterThanOrEqual(3);
    await s.app.inject({
      method: 'DELETE',
      url: `/api/v1/access-tokens/${s.accessTokenId}`,
      headers: {
        ...browserHeaders,
        cookie: cookieOf(s.login),
        'x-csrf-token': s.login.json().csrfToken,
      },
      payload: {},
    });
    release();
    expect((await pending).statusCode).toBe(401);
  });

  /** PAT-only selection rejects browser sessions, query credentials, and mixed transports. */
  it('should reject non-PAT and ambiguous collection credentials', async () => {
    const s = await setup();
    const payload = { source: { kind: 'favorites' } };
    const legacy = await s.c.login(
      { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
      native,
    );
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: { ...browserHeaders, cookie: cookieOf(s.login) },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: {
            authorization: `Bearer ${legacy.json().accessToken}`,
            'content-type': 'application/json',
          },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization/selections?token=${encodeURIComponent(s.token)}`,
          headers: s.headers,
          payload,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/metadata-organization/selections',
          headers: { ...s.headers, cookie: cookieOf(s.login) },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  });

  /** Closing a client request aborts a stalled collection read. */
  it('should propagate selection disconnect cancellation', async () => {
    const s = await setup();
    const address = await s.app.listen({ port: 0, host: '127.0.0.1' });
    s.c.state.collectionStall = true;
    const controller = new AbortController();
    const pending = fetch(`${address}/api/v1/metadata-organization/selections`, {
      method: 'POST',
      headers: s.headers,
      body: JSON.stringify({ source: { kind: 'playlist', playlistId: 'pl-1' } }),
      signal: controller.signal,
    }).catch(() => undefined);
    await expect
      .poll(() => s.c.requests.some((request) => request.pathname === '/rest/getPlaylist'))
      .toBe(true);
    controller.abort();
    await pending;
    await expect.poll(() => s.c.state.closedCollectionRequests).toBe(1);
    s.c.state.collectionStall = false;
  });
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
    const job = submit.json().job;
    s.c.storage.db.connection
      .prepare(
        "UPDATE organization_items SET baseline_json=?,stage='failed',error_code='database is locked',next_owner=NULL,lease_owner=NULL,lease_expires_at=NULL,encrypted_job_grant=NULL,grant_epoch=NULL WHERE id=?",
      )
      .run(JSON.stringify({ trackId: s.trackId, starred: false, playlists: [] }), job.itemId);
    const contentionReplay = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: body,
    });
    expect(contentionReplay.statusCode).toBe(202);
    expect(contentionReplay.json().job.stage).toBe('references_captured');
    expect(
      s.c.storage.db.connection
        .prepare(
          "SELECT count(*) AS count FROM organization_events WHERE kind='transient_requeued'",
        )
        .get()!.count,
    ).toBe(1);
    expect(
      s.c.storage.db.connection
        .prepare('SELECT encrypted_job_grant FROM organization_items WHERE id=?')
        .get(job.itemId)!.encrypted_job_grant,
    ).not.toBeNull();
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
    expect(
      (
        await s.app.inject({
          url: `/api/v1/metadata-organization-jobs/${job.id}`,
          headers: { authorization: `Bearer ${s.token}` },
        })
      ).json(),
    ).toEqual(contentionReplay.json());
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

  it('records one scoped target-replacement approval without exposing evidence paths', async () => {
    const s = await setup();
    const previewBody = {
      trackId: s.trackId,
      expectedRevision: s.revision,
      destinationPolicy: 'id3-managed-v1' as const,
    };
    const preview = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization/previews',
      headers: s.headers,
      payload: previewBody,
    });
    expect(preview.statusCode).toBe(200);
    const targetKey = String(preview.json().targetKey);
    const submit = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        ...previewBody,
        operationId: 'organization_replace_submit_0001',
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
    const job = submit.json().job;
    s.c.storage.mediaLinks.create({
      id: 'managed-target-alias',
      libraryId: 'music',
      relativeFileKey: targetKey,
      gonicSongId: 'displaced-track',
    });
    s.c.storage.db.connection
      .prepare(
        "UPDATE organization_items SET stage='scanning',lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
      )
      .run(job.itemId);
    const body = {
      operationId: 'target_replacement_approval_0001',
      displacedTrackId: 'displaced-track',
      backupReceiptDigest: 'a'.repeat(64),
      referenceSnapshotDigests: ['b'.repeat(64), 'c'.repeat(64)],
    };
    const approved = await s.app.inject({
      method: 'POST',
      url: `/api/v1/metadata-organization-jobs/${job.id}/target-replacements`,
      headers: s.headers,
      payload: body,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.body).not.toContain('backupReceiptDigest');
    expect(approved.body).not.toContain('referenceSnapshotDigests');
    expect(approved.json().job).toMatchObject({ id: job.id, stage: 'scanning' });
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization-jobs/${job.id}/target-replacements`,
          headers: s.headers,
          payload: body,
        })
      ).json(),
    ).toEqual(approved.json());
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: `/api/v1/metadata-organization-jobs/${job.id}/target-replacements`,
          headers: s.headers,
          payload: { ...body, backupReceiptDigest: 'd'.repeat(64) },
        })
      ).statusCode,
    ).toBe(409);
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

  /** Snapshot and cursor delta expose only the public identity resolution across organization completion. */
  it('publishes unresolved, pending, and verified replacement states without private organization data', async () => {
    const s = await setup();
    const previewBody = {
      trackId: s.trackId,
      expectedRevision: s.revision,
      destinationPolicy: 'id3-managed-v1',
    };
    const submitted = await s.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-organization-jobs',
      headers: s.headers,
      payload: {
        ...previewBody,
        operationId: 'identity_resolution_operation_0001',
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
    expect(submitted.statusCode, submitted.body).toBe(202);
    const itemId = String(submitted.json().job.itemId);
    const db = s.c.storage.db.connection;
    const mediaLinkId = String(
      db.prepare("SELECT media_link_id FROM metadata_items WHERE id='completed-item'").get()!
        .media_link_id,
    );
    const identityKey = String(
      db.prepare("SELECT identity_key FROM metadata_jobs WHERE id='completed-metadata'").get()!
        .identity_key,
    );
    db.prepare(
      "UPDATE metadata_items SET current_track_id='replacement-track',stage='reflecting',reflected_at=NULL,error_code='reflection_mismatch' WHERE id='completed-item'",
    ).run();
    db.prepare(
      "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES('completed-item',?,?, 'music','before','after','{\"trackIds\":[\"replacement-track\"],\"albumIds\":[],\"artistIds\":[],\"coverIds\":[]}','cover-generation','[\"title\"]','reflection_mismatch',?)",
    ).run(mediaLinkId, identityKey, recentNow);
    db.prepare(
      "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES('other-media','music','imports/other.mp3','other-track',1,'available',?,?)",
    ).run(recentNow, recentNow);
    db.prepare(
      "INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES('other-job',?,'music',?,?,?,1,'id3-managed-v1','completed-metadata','revision','[]',?)",
    ).run('7'.repeat(64), '8'.repeat(64), '9'.repeat(64), s.accessTokenId, recentNow);
    db.prepare(
      "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,audio_identity,stage,stage_changed_at) VALUES('other-item','other-job','other-media','imports/other.mp3','imports/other-new.mp3',?,'replacement-track',?,?,'succeeded',?)",
    ).run(s.trackId, 'a'.repeat(64), 'b'.repeat(64), recentNow);
    const replacementSong = {
      id: 'replacement-track',
      title: 'Replacement synthetic',
      isDir: false as const,
      path: `imports/account/Legacy/source.mp3`,
    };
    s.c.songs.push(replacementSong);
    const browserSessionHeaders = { ...browserHeaders, cookie: cookieOf(s.login) };
    const unresolved = await s.app.inject({
      url: '/api/v1/metadata-changes',
      headers: browserSessionHeaders,
    });
    expect(unresolved.statusCode, unresolved.body).toBe(200);
    expect(decodeMetadataChanges(unresolved.json()).changes).toMatchObject([
      { identityResolution: 'replacement_unresolved' },
    ]);

    db.prepare(
      "UPDATE organization_items SET stage='scanning',generation=1,lease_owner='gonic',lease_expires_at=? WHERE id=?",
    ).run(recentNow + 10_000, itemId);
    const targetKey = String(
      db.prepare('SELECT target_key FROM organization_items WHERE id=?').get(itemId)!.target_key,
    );
    const repository = createOrganizationRepository({
      database: s.c.storage.db,
      clock: () => recentNow,
    });
    const registration = {
      itemId,
      workerId: 'gonic',
      generation: 1,
    };
    repository.rebindCurrent({
      ...registration,
      newTrackId: replacementSong.id,
      targetFileIdentity: 'c'.repeat(64),
    });
    replacementSong.path = targetKey;
    const pending = await s.app.inject({
      url: `/api/v1/metadata-changes?cursor=${encodeURIComponent(unresolved.json().nextCursor)}`,
      headers: browserSessionHeaders,
    });
    expect(decodeMetadataChanges(pending.json()).changes).toMatchObject([
      { identityResolution: 'replacement_pending', reflection: 'reflection_mismatch' },
    ]);
    expect(pending.body).not.toContain(itemId);
    expect(pending.body).not.toContain(targetKey);
    expect(pending.body).not.toMatch(/sourceEvidence|actorToken|organizationJob/i);

    repository.completeRegistration({ ...registration, newTrackId: replacementSong.id });
    const references = repository.claimNext({
      workerId: 'references',
      leaseDurationMs: 10_000,
    })!;
    repository.transition({ ...references, stage: 'migrating_references' });
    repository.transition({ ...references, stage: 'verifying' });
    repository.completeVerifiedReferences(references);
    const verified = await s.app.inject({
      url: `/api/v1/metadata-changes?cursor=${encodeURIComponent(pending.json().nextCursor)}`,
      headers: browserSessionHeaders,
    });
    expect(decodeMetadataChanges(verified.json()).changes).toMatchObject([
      { identityResolution: 'replacement_verified', reflection: 'reflection_mismatch' },
    ]);
    expect(Number(verified.json().changes[0].sequence)).toBeGreaterThan(
      Number(pending.json().changes[0].sequence),
    );
    const restarted = await s.app.inject({
      url: '/api/v1/metadata-changes',
      headers: browserSessionHeaders,
    });
    expect(decodeMetadataChanges(restarted.json()).changes).toMatchObject([
      { identityResolution: 'replacement_verified' },
    ]);
  });
});
