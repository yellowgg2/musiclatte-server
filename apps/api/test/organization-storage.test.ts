import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { organizationGrantContext } from '../src/auth/metadata-job-authorizer.js';
import { createAccessTokenRepository } from '../src/storage/access-token-repository.js';
import { createOrganizationRepository } from '../src/storage/organization-repository.js';

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
    sourceEvidence: [{ url: 'https://example.invalid/source', fields: ['title'] }],
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
  return {
    c,
    tokens,
    issued,
    input: { ...base, grantEpoch, encryptedJobGrant },
    repository: createOrganizationRepository({ database: c.db, clock: () => 1_000 }),
  };
}

describe('organization storage', () => {
  it('migrates to v23 and keeps immutable intent idempotent', async () => {
    const s = await setup();
    expect(s.c.db.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 23 });
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
      baseline: { starred: true, playlists: [{ id: 'playlist', songIds: ['song-1', 'b'] }] },
    });
    s.repository.transition({ ...claim, stage: 'moving' });
    s.repository.transition({ ...claim, stage: 'moved' });
    s.repository.transition({ ...claim, stage: 'scanning' });
    s.repository.transition({ ...claim, stage: 'rebound', newTrackId: 'song-2' });
    s.repository.transition({ ...claim, stage: 'migrating_references' });
    s.repository.putReferenceCheckpoint({
      ...claim,
      kind: 'playlist',
      referenceId: 'playlist',
      baseline: ['song-1', 'b'],
      desired: ['song-2', 'b'],
    });
    s.repository.completeReferenceCheckpoint({
      ...claim,
      kind: 'playlist',
      referenceId: 'playlist',
    });
    expect(s.repository.referenceCheckpoints(s.input.itemId)).toEqual([
      expect.objectContaining({ referenceId: 'playlist', status: 'completed' }),
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
    expect(() => other.transition({ ...claim, workerId: 'worker-b', stage: 'verifying' })).toThrow(
      'conflict',
    );
  });

  it('keeps accepted work after revocation and restores active work to safe states', async () => {
    const s = await setup();
    s.repository.createOrReplay(s.input);
    expect(s.tokens.revokeOwned(proof.username, s.issued.accessToken.id)).toBe(true);
    const claim = s.repository.claimNext({ workerId: 'worker', leaseDurationMs: 100 })!;
    s.repository.recordReferences({ ...claim, baseline: { starred: false, playlists: [] } });
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
});
