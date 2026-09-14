import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { organizationGrantContext } from '../src/auth/metadata-job-authorizer.js';
import { createAccessTokenRepository } from '../src/storage/access-token-repository.js';
import { createCurationRepository } from '../src/storage/curation-repository.js';
import { createOrganizationRepository } from '../src/storage/organization-repository.js';
import { createWorkerLedger } from '../src/imports/worker-state.js';
import { createMetadataRepository } from '../src/storage/metadata-repository.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => context?.cleanup());

async function setup() {
  const c = (context = await createTestContext());
  const tokens = createAccessTokenRepository({
    database: c.db,
    vault: c.vault,
    clock: () => 1_000,
    maxAgeMs: 10_000,
  });
  const issued = tokens.create({
    name: 'Synthetic organization client',
    scopes: ['metadata:read', 'metadata:write'],
    libraryIds: ['library-1'],
    expiresAt: 5_000,
    proof,
  });
  c.mediaLinks.create({
    id: 'media-1',
    libraryId: 'library-1',
    relativeFileKey: 'jojo-music/account/Legacy/source.mp3',
    gonicSongId: 'song-1',
  });
  c.db.connection
    .prepare(
      "INSERT INTO metadata_jobs(id,identity_key,library_id,operation_id_hash,request_hash,kind,created_at) VALUES('metadata-job',?,'library-1',?,?,'edit',1000)",
    )
    .run('1'.repeat(64), '2'.repeat(64), '3'.repeat(64));
  c.sessions.create(proof);
  const actorSessionId = String(
    c.db.connection.prepare('SELECT id_hash FROM sessions LIMIT 1').get()!.id_hash,
  );
  c.db.connection
    .prepare(
      "INSERT INTO metadata_items(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,policy_revision,stage,stage_changed_at,changed_fields_json) VALUES('metadata-item','metadata-job',0,'media-1',?,1,'song-1','song-1','revision-1',?,'{\"title\":{\"op\":\"set\",\"value\":\"Title\"}}',?,1,'queued',1000,'[]')",
    )
    .run('f'.repeat(64), '0'.repeat(64), actorSessionId);
  const base = {
    id: 'organization-job',
    itemId: 'organization-item',
    identityKey: 'a'.repeat(64),
    libraryId: 'library-1',
    operationIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    actorTokenId: issued.accessToken.id,
    policyRevision: 1,
    policyVersion: 'id3-managed-v1' as const,
    metadataJobId: 'metadata-job',
    metadataRevision: 'revision-1',
    sourceEvidence: [
      { url: 'https://example.invalid/source', kind: 'official_artist', fields: ['title'] },
    ],
    mediaLinkId: 'media-1',
    sourceKey: 'jojo-music/account/Legacy/source.mp3',
    targetKey: 'jojo-music/account/ID3-managed/Artist/Album/01 - Title.mp3',
    oldTrackId: 'song-1',
    fileIdentity: 'd'.repeat(64),
    audioIdentity: 'e'.repeat(64),
  };
  const grantEpoch = String(
    c.db.connection.prepare('SELECT credential_epoch FROM automation_state').get()!
      .credential_epoch,
  );
  const encryptedJobGrant = c.vault.seal(
    proof,
    organizationGrantContext(c.db.connection, base.actorTokenId, base, grantEpoch).context,
  );
  const preimage = {
    device: '1',
    inode: '2',
    digest: '9'.repeat(64),
    mode: 0o640,
    uid: 1000,
    gid: 1000,
    audioIdentity: base.audioIdentity,
    targetParentDevice: '1',
    targetParentInode: '3',
  };
  return {
    c,
    tokens,
    issued,
    input: { ...base, grantEpoch, encryptedJobGrant },
    preimage,
    repository: createOrganizationRepository({ database: c.db, clock: () => 1_000 }),
  };
}

describe('organization storage', () => {
  /** Status projection resolves bounded targets in order and keeps current library identity isolated. */
  it('should project latest organization states for current scoped media links', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const readOrganizationStatuses = (
      s.repository as unknown as {
        readOrganizationStatuses?: (input: {
          targets: Array<
            { kind: 'track'; trackId: string } | { kind: 'media_link'; mediaLinkId: string }
          >;
          allowedLibraryIds: string[];
          currentPolicyVersion: string;
          requireInventoryIdentity?: boolean;
          signal?: AbortSignal;
        }) => Array<{
          target: unknown;
          state: string;
          reason: string;
          stage: string | null;
          changedAt: number | null;
        }>;
      }
    ).readOrganizationStatuses;
    expect(readOrganizationStatuses).toBeTypeOf('function');
    if (!readOrganizationStatuses) return;

    const controller = new AbortController();
    controller.abort();
    expect(() =>
      readOrganizationStatuses({
        targets: [{ kind: 'track', trackId: 'song-1' }],
        allowedLibraryIds: ['library-1'],
        currentPolicyVersion: 'id3-managed-v1',
        signal: controller.signal,
      }),
    ).toThrow(expect.objectContaining({ name: 'AbortError' }));

    const active = readOrganizationStatuses({
      targets: [
        { kind: 'track', trackId: 'song-1' },
        { kind: 'media_link', mediaLinkId: 'media-1' },
        { kind: 'track', trackId: 'missing' },
      ],
      allowedLibraryIds: ['library-1'],
      currentPolicyVersion: 'id3-managed-v1',
    });
    expect(active).toEqual([
      {
        target: { kind: 'track', trackId: 'song-1' },
        state: 'processing',
        reason: 'job_active',
        stage: 'queued',
        changedAt: 1_000,
      },
      {
        target: { kind: 'media_link', mediaLinkId: 'media-1' },
        state: 'processing',
        reason: 'job_active',
        stage: 'queued',
        changedAt: 1_000,
      },
      {
        target: { kind: 'track', trackId: 'missing' },
        state: 'unknown',
        reason: 'identity_unavailable',
        stage: null,
        changedAt: null,
      },
    ]);

    s.c.mediaLinks.create({
      id: 'media-2',
      libraryId: 'library-1',
      relativeFileKey: 'jojo-music/account/Unmanaged/source.mp3',
      gonicSongId: 'song-2',
    });
    s.c.mediaLinks.create({
      id: 'media-other',
      libraryId: 'library-2',
      relativeFileKey: 'jojo-music/other/Unmanaged/source.mp3',
      gonicSongId: 'song-1',
    });
    expect(
      readOrganizationStatuses({
        targets: [
          { kind: 'track', trackId: 'song-2' },
          { kind: 'media_link', mediaLinkId: 'media-other' },
        ],
        allowedLibraryIds: ['library-1'],
        currentPolicyVersion: 'id3-managed-v1',
      }),
    ).toEqual([
      {
        target: { kind: 'track', trackId: 'song-2' },
        state: 'needs_organization',
        reason: 'never_organized',
        stage: null,
        changedAt: null,
      },
      {
        target: { kind: 'media_link', mediaLinkId: 'media-other' },
        state: 'unknown',
        reason: 'identity_unavailable',
        stage: null,
        changedAt: null,
      },
    ]);
  });

  /** Succeeded status requires import provenance only for Musiclatte-imported media links. */
  it('should preserve legacy success while imported provenance stays fail closed', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const readOrganizationStatuses = (
      s.repository as unknown as {
        readOrganizationStatuses: (input: {
          targets: Array<{ kind: 'track'; trackId: string }>;
          allowedLibraryIds: string[];
          currentPolicyVersion: string;
        }) => Array<{ state: string; reason: string; stage: string | null }>;
      }
    ).readOrganizationStatuses;
    expect(readOrganizationStatuses).toBeTypeOf('function');
    if (!readOrganizationStatuses) return;

    const connection = s.c.db.connection;
    connection
      .prepare(
        "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES('metadata-item','media-1',?,'library-1','revision-0','revision-1','{}','cover-1','[\"title\"]','verified',1000)",
      )
      .run('1'.repeat(64));
    connection
      .prepare(
        "UPDATE media_links SET relative_file_key=?,gonic_song_id='song-2',revision=revision+1,validated_at=1000 WHERE id='media-1'",
      )
      .run(s.input.targetKey);
    connection
      .prepare(
        "UPDATE organization_items SET stage='succeeded',new_track_id='song-2',stage_changed_at=1100 WHERE id='organization-item'",
      )
      .run();
    const read = () =>
      readOrganizationStatuses({
        targets: [{ kind: 'track', trackId: 'song-2' }],
        allowedLibraryIds: ['library-1'],
        currentPolicyVersion: 'id3-managed-v1',
      })[0]!;
    expect(read()).toMatchObject({ state: 'organized', reason: 'verified', stage: 'succeeded' });

    connection
      .prepare(
        "INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES('import-job',?,'library-1',?,?,1000)",
      )
      .run('6'.repeat(64), '7'.repeat(64), '8'.repeat(64));
    connection
      .prepare(
        "INSERT INTO import_items(id,job_id,item_order,source_id,stage,media_link_id,stage_changed_at) VALUES('import-item','import-job',0,'synthetic-source','queued','media-1',1000)",
      )
      .run();
    expect(read()).toMatchObject({ state: 'organized', reason: 'verified' });
    for (const stage of ['registering', 'ready', 'duplicate'] as const) {
      connection
        .prepare(
          "UPDATE import_items SET stage=?,registering_at=1000,ready_at=CASE WHEN ?='ready' THEN 1000 ELSE ready_at END WHERE id='import-item'",
        )
        .run(stage, stage);
      expect(read()).toMatchObject({
        state: 'unknown',
        reason: 'verification_missing',
        stage: 'succeeded',
      });
    }

    s.repository.bindSourceLocation({
      itemId: 'organization-item',
      mediaLinkId: 'media-1',
      sourceId: 'synthetic-source',
      managedKey: s.input.targetKey,
    });
    expect(read()).toMatchObject({ state: 'organized', reason: 'verified' });
    connection
      .prepare(
        "UPDATE organization_source_locations SET source_id='different-source' WHERE media_link_id='media-1'",
      )
      .run();
    expect(read()).toMatchObject({
      state: 'needs_organization',
      reason: 'path_binding_changed',
    });
    connection
      .prepare('UPDATE organization_source_locations SET source_id=? WHERE media_link_id=?')
      .run('synthetic-source', 'media-1');
    expect(
      readOrganizationStatuses({
        targets: [{ kind: 'track', trackId: 'song-2' }],
        allowedLibraryIds: ['library-1'],
        currentPolicyVersion: 'id3-managed-v2',
      })[0],
    ).toMatchObject({ state: 'needs_organization', reason: 'policy_changed' });
    connection
      .prepare(
        "UPDATE organization_source_locations SET managed_key='jojo-music/account/ID3-managed/Other.mp3' WHERE media_link_id='media-1'",
      )
      .run();
    expect(read()).toMatchObject({ state: 'needs_organization', reason: 'path_binding_changed' });
    connection
      .prepare('UPDATE organization_source_locations SET managed_key=? WHERE media_link_id=?')
      .run(s.input.targetKey, 'media-1');

    s.repository.createOrReplay({
      ...s.input,
      id: 'older-organization-job',
      itemId: 'older-organization-item',
      identityKey: '9'.repeat(64),
      operationIdHash: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
    });
    connection
      .prepare(
        "UPDATE organization_items SET stage_changed_at=900 WHERE id='older-organization-item'",
      )
      .run();
    connection
      .prepare(
        "UPDATE organization_source_locations SET organization_item_id='older-organization-item' WHERE media_link_id='media-1'",
      )
      .run();
    expect(read()).toMatchObject({
      state: 'needs_organization',
      reason: 'path_binding_changed',
    });
    connection
      .prepare(
        'UPDATE organization_source_locations SET organization_item_id=? WHERE media_link_id=?',
      )
      .run('organization-item', 'media-1');

    const addMetadataChange = (id: string, fields: string[]) => {
      connection
        .prepare(
          "INSERT INTO metadata_jobs(id,identity_key,library_id,operation_id_hash,request_hash,kind,created_at) VALUES(?,?,?,?,?,'edit',1200)",
        )
        .run(
          `metadata-job-${id}`,
          id.repeat(64).slice(0, 64),
          'library-1',
          `${id}o`.repeat(64).slice(0, 64),
          `${id}r`.repeat(64).slice(0, 64),
        );
      connection
        .prepare(
          "INSERT INTO metadata_items(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,policy_revision,stage,stage_changed_at,file_saved_at,reflected_at,result_revision,result_digest,changed_fields_json) VALUES(?,?,0,'media-1',?,2,'song-2','song-2','revision-1',?,'{}',(SELECT id_hash FROM sessions LIMIT 1),1,'succeeded',1200,1200,1200,'revision-2',?,?)",
        )
        .run(
          `metadata-item-${id}`,
          `metadata-job-${id}`,
          id.repeat(64).slice(0, 64),
          `${id}d`.repeat(64).slice(0, 64),
          `${id}g`.repeat(64).slice(0, 64),
          JSON.stringify(fields),
        );
      connection
        .prepare(
          "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES(?,'media-1',?,'library-1','revision-1','revision-2','{}','cover-2',?,'verified',1200)",
        )
        .run(`metadata-item-${id}`, id.repeat(64).slice(0, 64), JSON.stringify(fields));
    };
    addMetadataChange('4', ['cover', 'genre', 'lyrics', 'year']);
    expect(read()).toMatchObject({ state: 'organized', reason: 'verified' });
    addMetadataChange('5', ['title']);
    expect(read()).toMatchObject({
      state: 'needs_organization',
      reason: 'path_metadata_changed',
    });
  });

  /** Latest-attempt tie breaking and inventory identity cannot hide attention or stale rows. */
  it('should use id-desc tie breaks and require verified current inventory when requested', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const readOrganizationStatuses = (
      s.repository as unknown as {
        readOrganizationStatuses: (input: {
          targets: Array<{ kind: 'media_link'; mediaLinkId: string }>;
          allowedLibraryIds: string[];
          currentPolicyVersion: string;
          requireInventoryIdentity?: boolean;
        }) => Array<{ state: string; reason: string; stage: string | null }>;
      }
    ).readOrganizationStatuses;
    expect(readOrganizationStatuses).toBeTypeOf('function');
    if (!readOrganizationStatuses) return;

    s.repository.createOrReplay({
      ...s.input,
      id: 'organization-job-z',
      itemId: 'organization-item-z',
      identityKey: '6'.repeat(64),
      operationIdHash: '7'.repeat(64),
      requestHash: '8'.repeat(64),
    });
    s.c.db.connection
      .prepare(
        "UPDATE organization_items SET stage='failed',error_code='synthetic_failure',stage_changed_at=1000 WHERE id='organization-item-z'",
      )
      .run();
    const read = (requireInventoryIdentity = false) =>
      readOrganizationStatuses({
        targets: [{ kind: 'media_link', mediaLinkId: 'media-1' }],
        allowedLibraryIds: ['library-1'],
        currentPolicyVersion: 'id3-managed-v1',
        requireInventoryIdentity,
      })[0]!;
    expect(read()).toMatchObject({ state: 'attention', reason: 'job_failed', stage: 'failed' });
    for (const [stage, reason] of [
      ['conflict', 'job_conflict'],
      ['recovery_required', 'recovery_required'],
    ] as const) {
      s.c.db.connection
        .prepare('UPDATE organization_items SET stage=?,error_code=? WHERE id=?')
        .run(stage, `synthetic_${stage}`, 'organization-item-z');
      expect(read()).toMatchObject({ state: 'attention', reason, stage });
    }
    for (const stage of [
      'moved',
      'scanning',
      'rebound',
      'migrating_references',
      'verifying',
    ] as const) {
      s.c.db.connection
        .prepare('UPDATE organization_items SET stage=?,error_code=NULL WHERE id=?')
        .run(stage, 'organization-item-z');
      expect(read()).toMatchObject({ state: 'processing', reason: 'job_active', stage });
    }
    expect(read(true)).toMatchObject({ state: 'unknown', reason: 'identity_unavailable' });

    const trackRef = createCurationRepository({
      database: s.c.db,
      clock: () => 1_000,
      cursorKey: new Uint8Array(32).fill(1),
      limits: {
        claimLeaseMs: 100,
        maxTargets: 100,
        snapshotMaxAgeMs: 10_000,
        snapshotMaxItems: 1_000,
        snapshotMaxCount: 10,
      },
    }).discover({
      libraryId: 'library-1',
      trackId: 'song-1',
      format: 'mp3',
      mediaLinkId: 'media-1',
      fileIdentity: 'd'.repeat(64),
      bindingRevision: 1,
    });
    s.c.db.connection
      .prepare("UPDATE curation_tracks SET validation='verified' WHERE id=?")
      .run(trackRef);
    expect(read(true)).toMatchObject({ state: 'processing', reason: 'job_active' });
    s.c.db.connection.prepare('UPDATE curation_tracks SET tombstoned=1 WHERE id=?').run(trackRef);
    expect(read(true)).toMatchObject({ state: 'unknown', reason: 'identity_unavailable' });
  });

  /** The additive migration installs the dedicated deterministic latest-state lookup index. */
  it('should migrate the organization status lookup index and use it in the bounded plan', async () => {
    const s = await setup();
    expect(s.c.db.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 29 });
    const plan = s.c.db.connection
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM organization_items WHERE media_link_id=? ORDER BY stage_changed_at DESC,id DESC LIMIT 1',
      )
      .all('media-1');
    expect(plan.map((row) => String(row.detail)).join('\n')).toContain(
      'organization_items_status_lookup',
    );
  });

  it('accepts an exact existing source beneath a whitespace-ending directory', async () => {
    const s = await setup();

    const job = s.repository.createOrReplay({
      ...s.input,
      sourceKey: 'jojo-music/account/Legacy Artist /source.mp3',
    });

    expect(job.item.sourceKey).toBe('jojo-music/account/Legacy Artist /source.mp3');
  });

  it('accepts consecutive periods inside safe path components', async () => {
    const s = await setup();
    const job = s.repository.createOrReplay({
      ...s.input,
      targetKey:
        "jojo-music/account/ID3-managed/Artist/I Said I Love You First... And You Said It Back/01 - That's When I'll Care.mp3",
    });

    expect(job.item.targetKey).toContain('First... And');
    expect(() =>
      s.c.db.connection
        .prepare("UPDATE organization_items SET target_key='jojo-music/account/../escape.mp3'")
        .run(),
    ).toThrow('CHECK constraint failed');
  });

  it('migrates through the organization schemas and keeps immutable intent idempotent', async () => {
    const s = await setup();
    expect(s.c.db.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 29 });
    const first = s.repository.createOrReplay(s.input);
    expect(
      s.repository.createOrReplay({ ...s.input, id: 'discarded', itemId: 'discarded-item' }),
    ).toEqual(first);
    expect(() => s.repository.createOrReplay({ ...s.input, requestHash: 'f'.repeat(64) })).toThrow(
      'conflict',
    );
    const raw = s.c.db.connection.prepare('SELECT * FROM organization_jobs').get()!;
    expect(JSON.stringify(raw)).not.toContain(s.issued.token);
    expect(JSON.stringify(raw)).not.toContain(proof.t);
    expect(JSON.stringify(raw)).not.toContain('lyrics text');
    expect(raw.request_hash).toBe(s.input.requestHash);
    expect(() =>
      s.c.db.connection.prepare("UPDATE organization_events SET kind='tampered'").run(),
    ).toThrow('append-only event');
  });

  it('fences leases, persists a baseline, and resumes reference checkpoints', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const claim = s.repository.claimNext({ workerId: 'worker-a', leaseDurationMs: 100 })!;
    expect(claim).toMatchObject({ itemId: s.input.itemId, generation: 1, stage: 'validating' });
    const other = createOrganizationRepository({ database: s.c.open(), clock: () => 1_000 });
    expect(other.claimNext({ workerId: 'worker-b', leaseDurationMs: 100 })).toBeNull();
    s.repository.recordReferences({
      ...claim,
      baseline: {
        trackId: 'song-1',
        starred: true,
        playlists: [{ id: 'playlist', songIds: ['song-1', 'b'] }],
      },
    });
    s.repository.recordMovePreimage({ ...claim, preimage: s.preimage });
    s.repository.transition({ ...claim, stage: 'moving' });
    s.repository.transition({ ...claim, stage: 'moved' });
    const downstream = s.repository.claimNext({ workerId: 'worker-a', leaseDurationMs: 100 })!;
    expect(downstream).toMatchObject({ stage: 'moved', generation: 2 });
    s.repository.transition({ ...downstream, stage: 'scanning' });
    s.repository.transition({ ...downstream, stage: 'rebound', newTrackId: 'song-2' });
    const references = s.repository.claimNext({ workerId: 'worker-a', leaseDurationMs: 100 })!;
    expect(references).toMatchObject({ stage: 'rebound', generation: 3 });
    s.repository.transition({ ...references, stage: 'migrating_references' });
    expect(s.repository.readBaseline(references)).toEqual({
      trackId: 'song-1',
      starred: true,
      playlists: [{ id: 'playlist', songIds: ['song-1', 'b'] }],
    });
    s.repository.putReferenceCheckpoint({
      ...references,
      kind: 'playlist',
      referenceId: 'playlist',
      baseline: ['song-1', 'b'],
      desired: ['song-2', 'b'],
    });
    s.repository.completeReferenceCheckpoint({
      ...references,
      kind: 'playlist',
      referenceId: 'playlist',
    });
    s.repository.putReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
      baseline: true,
      desired: true,
    });
    s.repository.failReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
      errorCode: 'reference_conflict',
    });
    s.repository.putReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
      baseline: true,
      desired: true,
    });
    s.repository.completeReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
    });
    expect(s.repository.referenceCheckpoints(s.input.itemId)).toEqual([
      expect.objectContaining({ referenceId: 'playlist', status: 'completed' }),
      expect.objectContaining({ referenceId: 'star', status: 'completed' }),
    ]);
    s.repository.bindSourceLocation({
      itemId: s.input.itemId,
      mediaLinkId: s.input.mediaLinkId,
      sourceId: 'youtube-fixture-id',
      managedKey: s.input.targetKey,
    });
    expect(s.repository.sourceLocation('youtube-fixture-id')).toMatchObject({
      mediaLinkId: s.input.mediaLinkId,
      managedKey: s.input.targetKey,
    });
    expect(() =>
      other.transition({ ...downstream, workerId: 'worker-b', stage: 'verifying' }),
    ).toThrow('conflict');
  });

  it('keeps accepted work after revocation and restores active work to safe states', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    expect(s.tokens.revokeOwned(proof.username, s.issued.accessToken.id)).toBe(true);
    const claim = s.repository.claimNext({ workerId: 'worker', leaseDurationMs: 100 })!;
    s.repository.recordReferences({
      ...claim,
      baseline: { trackId: 'song-1', starred: false, playlists: [] },
    });
    s.repository.recordMovePreimage({ ...claim, preimage: s.preimage });
    s.repository.transition({ ...claim, stage: 'moving' });
    s.repository.transition({ ...claim, stage: 'moved' });

    const source = join(s.c.root, 'organization-backup');
    await s.c.createBackup(s.c.db, s.c.keyPath, source);
    const destination = join(s.c.root, 'organization-restored');
    await s.c.restoreBackup(source, destination);
    const restored = s.c.open(destination);
    expect(
      restored.connection
        .prepare('SELECT stage,lease_owner,encrypted_job_grant FROM organization_items')
        .get(),
    ).toEqual({ stage: 'recovery_required', lease_owner: null, encrypted_job_grant: null });
    expect(
      restored.connection.prepare('SELECT next_owner FROM organization_items').get()?.next_owner,
    ).toBe('filesystem');
    expect(
      restored.connection.prepare('SELECT count(*) AS count FROM organization_attempts').get()
        ?.count,
    ).toBe(1);
    expect(
      restored.connection.prepare('SELECT encrypted_proof FROM access_tokens').get()
        ?.encrypted_proof,
    ).toBeNull();
  });

  it('turns an expired moving lease into filesystem-owned recovery', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const claim = s.repository.claimNext({ workerId: 'dead-worker', leaseDurationMs: 100 })!;
    s.repository.recordReferences({
      ...claim,
      baseline: { trackId: 'song-1', starred: false, playlists: [] },
    });
    s.repository.recordMovePreimage({ ...claim, preimage: s.preimage });
    s.repository.transition({ ...claim, stage: 'moving' });
    const recoveryRepository = createOrganizationRepository({
      database: s.c.open(),
      clock: () => 1_101,
    });
    const recovery = recoveryRepository.claimNext({
      workerId: 'recovery-worker',
      leaseDurationMs: 100,
      recoveryOnly: true,
    })!;
    expect(recovery).toMatchObject({
      stage: 'recovery_required',
      generation: 2,
      workerId: 'recovery-worker',
    });
    expect(
      s.c.db.connection.prepare('SELECT error_code,next_owner FROM organization_items').get(),
    ).toEqual({ error_code: 'worker_interrupted', next_owner: 'filesystem' });
    recoveryRepository.transition({
      ...recovery,
      stage: 'recovery_required',
      errorCode: 'identity_mismatch',
    });
    expect(
      s.c.db.connection
        .prepare('SELECT error_code,next_owner,lease_owner FROM organization_items')
        .get(),
    ).toEqual({ error_code: 'identity_mismatch', next_owner: 'filesystem', lease_owner: null });
  });

  it('relinquishes a failed stage lease for the next recovery owner immediately', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    const file = s.repository.claimNext({
      workerId: 'filesystem-worker',
      leaseDurationMs: 30_000,
      fileOnly: true,
    })!;
    s.repository.recordReferences({
      ...file,
      baseline: { trackId: 'song-1', starred: false, playlists: [] },
    });
    s.repository.recordMovePreimage({ ...file, preimage: s.preimage });
    s.repository.transition({ ...file, stage: 'moving' });
    s.repository.transition({ ...file, stage: 'moved' });
    const registration = s.repository.claimNext({
      workerId: 'gonic-worker',
      leaseDurationMs: 30_000,
      registrationOnly: true,
    })!;
    s.repository.transition({ ...registration, stage: 'scanning' });
    s.repository.transition({
      ...registration,
      stage: 'recovery_required',
      errorCode: 'registration_pending',
    });

    expect(
      s.c.db.connection
        .prepare('SELECT lease_owner,lease_expires_at,next_owner FROM organization_items')
        .get(),
    ).toEqual({ lease_owner: null, lease_expires_at: null, next_owner: 'gonic' });
    expect(
      s.repository.claimNext({
        workerId: 'gonic-recovery-worker',
        leaseDurationMs: 30_000,
        registrationOnly: true,
      }),
    ).toMatchObject({
      stage: 'recovery_required',
      generation: 3,
      workerId: 'gonic-recovery-worker',
    });
  });

  /** Rebinding publishes one durable pending delta while preserving the original audit payload. */
  it('atomically rebinds the stable media link and every current projection', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    s.c.db.connection
      .prepare(
        "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES('metadata-item','media-1',?,'library-1','revision-1','revision-2','{\"albumId\":\"album-1\"}','cover-1','[\"title\"]','reflection_mismatch',900)",
      )
      .run('1'.repeat(64));
    const originalChange = s.c.db.connection
      .prepare("SELECT * FROM metadata_changes WHERE item_id='metadata-item'")
      .get()!;
    s.c.imports.createJob({
      id: 'source-job',
      identityKey: '8'.repeat(64),
      libraryId: 'library-1',
      operationIdHash: '7'.repeat(64),
      requestHash: '6'.repeat(64),
      items: [{ id: 'source-item', sourceId: 'youtube-source' }],
    });
    s.c.db.connection
      .prepare(
        "UPDATE import_items SET stage='ready',media_link_id='media-1',ready_at=1000 WHERE id='source-item'",
      )
      .run();
    const curation = createCurationRepository({
      database: s.c.db,
      clock: () => 1_000,
      cursorKey: new Uint8Array(32),
      limits: {
        claimLeaseMs: 100,
        maxTargets: 10,
        snapshotMaxAgeMs: 100,
        snapshotMaxItems: 10,
        snapshotMaxCount: 10,
      },
    });
    const trackRef = curation.discover({
      libraryId: 'library-1',
      trackId: 'song-1',
      format: 'mp3',
      mediaLinkId: 'media-1',
      fileIdentity: s.input.fileIdentity,
      bindingRevision: 1,
    });
    const move = s.repository.claimNext({ workerId: 'filesystem', leaseDurationMs: 100 })!;
    s.repository.recordReferences({
      ...move,
      baseline: { trackId: 'song-1', starred: false, playlists: [] },
    });
    s.repository.recordMovePreimage({ ...move, preimage: s.preimage });
    s.repository.transition({ ...move, stage: 'moving' });
    s.repository.transition({ ...move, stage: 'moved' });
    const registration = s.repository.claimNext({
      workerId: 'gonic',
      leaseDurationMs: 100,
      registrationOnly: true,
    })!;
    s.repository.transition({ ...registration, stage: 'scanning' });
    expect(
      s.repository.rebindCurrent({
        ...registration,
        newTrackId: 'song-2',
        targetFileIdentity: '5'.repeat(64),
      }),
    ).toEqual({ trackRef });
    const pendingChange = s.c.db.connection
      .prepare("SELECT * FROM metadata_changes WHERE item_id='metadata-item'")
      .get()!;
    expect(Number(pendingChange.sequence)).toBeGreaterThan(Number(originalChange.sequence));
    expect({
      ...pendingChange,
      sequence: originalChange.sequence,
      created_at: originalChange.created_at,
    }).toEqual(originalChange);
    expect(
      s.c.db.connection
        .prepare('SELECT item_id,resolution FROM organization_identity_publications')
        .all(),
    ).toEqual([{ item_id: 'organization-item', resolution: 'replacement_pending' }]);
    s.repository.rebindCurrent({
      ...registration,
      newTrackId: 'song-2',
      targetFileIdentity: '5'.repeat(64),
    });
    expect(
      s.c.db.connection
        .prepare("SELECT sequence FROM metadata_changes WHERE item_id='metadata-item'")
        .get(),
    ).toEqual({ sequence: pendingChange.sequence });
    expect(s.c.mediaLinks.get('media-1')).toMatchObject({
      id: 'media-1',
      relativeFileKey: s.input.targetKey,
      gonicSongId: 'song-2',
      revision: 2,
      availability: 'available',
    });
    expect(
      s.c.db.connection
        .prepare(
          "SELECT original_track_id,current_track_id FROM metadata_items WHERE id='metadata-item'",
        )
        .get(),
    ).toEqual({ original_track_id: 'song-1', current_track_id: 'song-2' });
    expect(curation.rowFor(trackRef)).toMatchObject({
      track_id: 'song-2',
      media_link_id: 'media-1',
      file_identity: '5'.repeat(64),
      binding_revision: 2,
    });
    s.repository.completeRegistration({ ...registration, newTrackId: 'song-2' });
    expect(s.repository.sourceLocation('youtube-source')).toMatchObject({
      mediaLinkId: 'media-1',
      managedKey: s.input.targetKey,
    });
    const imports = createWorkerLedger(s.c.db, () => 1_000, 'import-worker', 100);
    expect(imports.findManagedSource('library-1', 'youtube-source')).toEqual({
      id: 'media-1',
      fileKey: s.input.targetKey,
    });
    const metadata = createMetadataRepository({ database: s.c.db, clock: () => 1_000 });
    const metadataClaim = metadata.claimNext({
      workerId: 'metadata-worker',
      leaseDurationMs: 100,
    })!;
    expect(metadata.readWork(metadataClaim)).toMatchObject({
      mediaLinkId: 'media-1',
      key: s.input.targetKey,
      trackId: 'song-2',
      originalTrackId: 'song-1',
      currentBindingRevision: 2,
    });
    expect(s.repository.getJob(s.input.id)!.item).toMatchObject({
      stage: 'rebound',
      newTrackId: 'song-2',
    });
    const references = s.repository.claimNext({
      workerId: 'references',
      leaseDurationMs: 100,
    })!;
    s.repository.transition({ ...references, stage: 'migrating_references' });
    s.repository.putReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
      baseline: false,
      desired: false,
    });
    s.repository.completeReferenceCheckpoint({
      ...references,
      kind: 'star',
      referenceId: 'star',
    });
    s.repository.transition({ ...references, stage: 'verifying' });
    const beforeVerified = s.c.db.connection
      .prepare("SELECT * FROM metadata_changes WHERE item_id='metadata-item'")
      .get()!;
    expect(() => s.repository.transition({ ...references, stage: 'succeeded' })).toThrow(
      'invalid_transition',
    );
    expect(s.repository.completeVerifiedReferences(references)).toMatchObject({
      stage: 'succeeded',
      newTrackId: 'song-2',
    });
    const verifiedChange = s.c.db.connection
      .prepare("SELECT * FROM metadata_changes WHERE item_id='metadata-item'")
      .get()!;
    expect(Number(verifiedChange.sequence)).toBeGreaterThan(Number(beforeVerified.sequence));
    expect({
      ...verifiedChange,
      sequence: beforeVerified.sequence,
      created_at: beforeVerified.created_at,
    }).toEqual(beforeVerified);
    expect(
      s.c.db.connection
        .prepare(
          'SELECT item_id,resolution FROM organization_identity_publications ORDER BY resolution',
        )
        .all(),
    ).toEqual([
      { item_id: 'organization-item', resolution: 'replacement_pending' },
      { item_id: 'organization-item', resolution: 'replacement_verified' },
    ]);
    expect(
      s.c.db.connection.prepare('SELECT count(*) AS count FROM listening_events').get(),
    ).toEqual({ count: 0 });
    expect(
      s.c.db.connection.prepare('SELECT count(*) AS count FROM listening_deliveries').get(),
    ).toEqual({ count: 0 });
  });

  /** Publication failure rolls back the binding, durable marker, and sequence together. */
  it('rolls back every rebind effect when pending publication fails', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    s.c.db.connection
      .prepare(
        "INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES('metadata-item','media-1',?,'library-1','revision-1','revision-2','{}','cover-1','[]','verified',900)",
      )
      .run('1'.repeat(64));
    s.c.db.connection
      .prepare(
        "UPDATE organization_items SET stage='scanning',generation=1,lease_owner='worker',lease_expires_at=1100 WHERE id='organization-item'",
      )
      .run();
    s.c.db.connection.exec(
      "CREATE TRIGGER reject_identity_delta BEFORE UPDATE OF sequence ON metadata_changes BEGIN SELECT RAISE(ABORT,'reject identity delta'); END;",
    );

    expect(() =>
      s.repository.rebindCurrent({
        itemId: 'organization-item',
        workerId: 'worker',
        generation: 1,
        newTrackId: 'song-2',
        targetFileIdentity: '5'.repeat(64),
      }),
    ).toThrow('reject identity delta');
    expect(s.c.mediaLinks.get('media-1')).toMatchObject({
      relativeFileKey: s.input.sourceKey,
      gonicSongId: 'song-1',
      revision: 1,
    });
    expect(
      s.c.db.connection
        .prepare("SELECT current_track_id FROM metadata_items WHERE id='metadata-item'")
        .get(),
    ).toEqual({ current_track_id: 'song-1' });
    expect(
      s.c.db.connection
        .prepare("SELECT new_track_id FROM organization_items WHERE id='organization-item'")
        .get(),
    ).toEqual({ new_track_id: null });
    expect(
      s.c.db.connection.prepare('SELECT * FROM organization_identity_publications').all(),
    ).toEqual([]);
  });

  /** Organization completion without metadata history records proof but creates no synthetic change. */
  it('does not create a metadata change when verified references have no change row', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    s.c.db.connection
      .prepare(
        "UPDATE organization_items SET stage='verifying',new_track_id='song-2',generation=1,lease_owner='worker',lease_expires_at=1100 WHERE id='organization-item'",
      )
      .run();

    expect(
      s.repository.completeVerifiedReferences({
        itemId: 'organization-item',
        workerId: 'worker',
        generation: 1,
      }),
    ).toMatchObject({ stage: 'succeeded' });
    expect(s.c.db.connection.prepare('SELECT * FROM metadata_changes').all()).toEqual([]);
    expect(
      s.c.db.connection
        .prepare('SELECT item_id,resolution FROM organization_identity_publications')
        .all(),
    ).toEqual([{ item_id: 'organization-item', resolution: 'replacement_verified' }]);
  });
});
