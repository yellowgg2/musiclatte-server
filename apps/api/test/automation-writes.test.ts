import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCurationMutationContext } from '../../../tests/support/curation-mutation-harness.js';
it('previews without durable effects and admits only valid targets with replayable results', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'required_review', fields: ['title'], targets },
        headers,
      )
    ).json();
    const body = {
      operationId: randomUUID(),
      targets: [...targets, { trackId: 'absent', expectedRevision: 'unknown' }],
      patch: { title: { op: 'set', value: 'Synthetic new title' } },
      automation: {
        claimId: claim.claimId,
        claimGeneration: claim.generation,
        purpose: 'required_review',
        sourceNotes: null,
      },
      dryRun: true,
    };
    const original = readFileSync(join(c.root, 'source.mp3'));
    const count = () =>
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM curation_operations').get()!.n;
    const before = count();
    const dry = await c.post('metadata-jobs', body, headers);
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toMatchObject({
      dryRun: true,
      writeGuaranteed: false,
      results: [
        { trackId: 'track-1', status: 'changed' },
        { trackId: 'absent', status: 'rejected' },
      ],
    });
    expect(count()).toBe(before);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()!.n,
    ).toBe(0);
    expect(readFileSync(join(c.root, 'source.mp3'))).toEqual(original);
    const submit = { ...body, dryRun: false };
    const first = await c.post('metadata-jobs', submit, headers);
    expect(first.statusCode).toBe(202);
    expect(first.json().job.items).toHaveLength(1);
    expect(first.json().admissionResults[1]).toMatchObject({ status: 'rejected', jobItemId: null });
    c.setNow(c.clock() + 1000);
    expect((await c.post('metadata-jobs', submit, headers)).json()).toEqual(first.json());
    expect(
      (await c.post('metadata-jobs', { ...submit, sourceReference: 'changed' }, headers))
        .statusCode,
    ).toBe(409);
  } finally {
    await c.cleanup();
  }
});

it('admits automation while a file-verified album projection waits for organization', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token(['metadata:read', 'metadata:write', 'curation:write']);
    const track = c.repository.rowFor(c.trackRef)!;
    const token = c.storage.db.connection
      .prepare('SELECT id FROM access_tokens ORDER BY created_at DESC,id DESC LIMIT 1')
      .get()!;
    const snapshot = await c.helper.read({ key: 'imports/source.mp3' });
    c.storage.db.connection
      .prepare(
        "INSERT INTO metadata_jobs(id,identity_key,library_id,operation_id_hash,request_hash,kind,created_at) VALUES('album-pending-job',?,'music',?,?,'edit',?)",
      )
      .run('c'.repeat(64), 'a'.repeat(64), 'b'.repeat(64), c.clock());
    c.storage.db.connection
      .prepare(
        'INSERT INTO metadata_items(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_token_id,policy_revision,stage,generation,stage_changed_at,file_saved_at,result_revision,result_digest,changed_fields_json,next_reflection_at,error_code) VALUES(\'album-pending-item\',\'album-pending-job\',0,?,?,?,?,?,?,?,\'{"album":{"op":"set","value":"Synthetic album"}}\',?,1,\'reflecting\',1,?,?,?,?,\'["album"]\',0,\'reflection_mismatch\')',
      )
      .run(
        String(track.media_link_id),
        String(track.file_identity),
        Number(track.binding_revision),
        'track-1',
        'track-1',
        String(track.revision),
        snapshot.fullDigest,
        String(token.id),
        c.clock(),
        c.clock(),
        String(track.revision),
        snapshot.fullDigest,
      );
    c.storage.db.connection
      .prepare(
        'INSERT INTO metadata_item_evidence(item_id,references_json,reflection_json,updated_at) VALUES(?,?,?,?)',
      )
      .run(
        'album-pending-item',
        JSON.stringify({ trackId: 'track-1', starred: false, playlists: [] }),
        JSON.stringify({ fileVerifiedFields: ['album'], mismatched: ['album'] }),
        c.clock(),
      );
    const targets = [{ trackId: 'track-1', expectedRevision: String(track.revision) }];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'required_review', fields: ['title'], targets },
        headers,
      )
    ).json();
    const response = await c.post(
      'metadata-jobs',
      {
        operationId: randomUUID(),
        targets,
        patch: { title: { op: 'set', value: 'Synthetic successor title' } },
        automation: {
          claimId: claim.claimId,
          claimGeneration: claim.generation,
          purpose: 'required_review',
          sourceNotes: null,
        },
        dryRun: false,
      },
      headers,
    );
    expect(response.statusCode).toBe(202);
    expect(response.json().admissionResults).toEqual([
      { trackId: 'track-1', status: 'accepted', jobItemId: expect.any(String) },
    ]);
  } finally {
    await c.cleanup();
  }
});

/** An admitted grant remains executable after the client promptly releases its curation claim. */
it('writes original lyrics through the P4 worker after immediate claim release', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const before = await c.helper.read({ key: 'imports/source.mp3' });
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'optional_enrichment', fields: ['lyrics'], targets },
        headers,
      )
    ).json();
    const body = {
      operationId: randomUUID(),
      targets,
      patch: {
        lyrics: {
          op: 'set',
          selector: { language: 'eng', description: 'automation-test' },
          text: 'A small warm song I wrote for this test.',
        },
      },
      automation: {
        claimId: claim.claimId,
        claimGeneration: 1,
        purpose: 'optional_enrichment',
        sourceNotes: 'Original synthetic lyrics',
      },
      dryRun: false,
    };
    const accepted = await c.post('metadata-jobs', body, headers);
    expect(accepted.statusCode).toBe(202);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: '/api/v1/curation-claims/' + claim.claimId,
          headers: { authorization: headers.authorization },
        })
      ).statusCode,
    ).toBe(204);
    expect(c.repository.activeClaim(c.trackRef)).toBeUndefined();
    c.storage.db.connection
      .prepare('UPDATE access_tokens SET revoked_at=?,encrypted_proof=NULL')
      .run(c.clock());
    const { createAutomationTestWorker } =
      await import('../../../tests/support/automation-worker-harness.js');
    const w = createAutomationTestWorker(c);
    expect(await w.worker.runOnce()).toBe(true);
    expect(
      c.storage.db.connection.prepare('SELECT stage,error_code FROM metadata_items').get(),
    ).toMatchObject({ stage: 'file_saved', error_code: null });
    const actual = await c.helper.read({ key: 'imports/source.mp3' });
    expect(actual.lyricsFrames).toContainEqual({
      selector: body.patch.lyrics.selector,
      text: body.patch.lyrics.text,
    });
    expect(actual.values).toEqual(before.values);
    expect(actual.audio.packetHash).toBe(before.audio.packetHash);
    expect(actual.coverFrames).toEqual(before.coverFrames);
    expect(
      w.repository.getJob(
        accepted.json().job.id,
        String(
          c.storage.db.connection.prepare('SELECT identity_key FROM metadata_jobs').get()!
            .identity_key,
        ),
      )!.items[0]!.stage,
    ).toBe('file_saved');
    expect(
      (await c.post('metadata-jobs', { ...body, operationId: randomUUID() }, headers)).statusCode,
    ).toBe(401);
  } finally {
    await c.cleanup();
  }
});

it('admits replace-all JPEG normalization through an optional automation claim', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const upload = await c.app.inject({
      method: 'POST',
      url: '/api/v1/metadata-covers',
      headers: {
        ...headers,
        'content-type': 'image/jpeg',
        'x-operation-id': randomUUID(),
        'x-metadata-library-id': 'music',
      },
      payload: readFileSync('docs/verification/phase-1/step-08/empty-en-desktop.jpg'),
    });
    expect(upload.statusCode).toBe(201);
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'optional_enrichment', fields: ['cover'], targets },
        headers,
      )
    ).json();
    const accepted = await c.post(
      'metadata-jobs',
      {
        operationId: randomUUID(),
        targets,
        patch: { cover: { op: 'replaceAll', uploadId: upload.json().uploadId } },
        automation: {
          claimId: claim.claimId,
          claimGeneration: claim.generation,
          purpose: 'optional_enrichment',
          sourceNotes: 'Synthetic JPEG normalization',
        },
        dryRun: false,
      },
      headers,
    );
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().admissionResults).toMatchObject([{ status: 'accepted' }]);
  } finally {
    await c.cleanup();
  }
});

it('returns no-change for identical values and rejects revoked or insufficient credentials before enqueue', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'required_review', fields: ['title'], targets },
        headers,
      )
    ).json();
    const title = (await c.helper.read({ key: 'imports/source.mp3' })).values.title;
    const body = {
      operationId: randomUUID(),
      targets,
      patch: { title: { op: 'set', value: title } },
      automation: {
        claimId: claim.claimId,
        claimGeneration: 1,
        purpose: 'required_review',
        sourceNotes: null,
      },
      dryRun: true,
    };
    const dry = await c.post('metadata-jobs', body, headers);
    expect(dry.statusCode).toBe(200);
    expect(dry.json().results[0]).toMatchObject({
      status: 'no_change',
      diff: [{ field: 'title', status: 'no_change' }],
    });
    expect(
      (await c.post('metadata-jobs', body, await c.token(['metadata:read', 'curation:write'])))
        .statusCode,
    ).toBe(403);
    const noLyrics = await c.token(['metadata:read', 'metadata:write', 'curation:write']);
    expect(
      (
        await c.post(
          'metadata-jobs',
          {
            ...body,
            patch: {
              lyrics: {
                op: 'set',
                selector: { language: 'eng', description: '' },
                text: 'Original synthetic lyrics',
              },
            },
          },
          noLyrics,
        )
      ).statusCode,
    ).toBe(403);
    const acquire = c.fence.acquire.bind(c.fence);
    c.fence.acquire = async (...args) => {
      const held = await acquire(...args);
      const validate = held.validate.bind(held);
      held.validate = async () => {
        await validate();
        c.storage.db.connection
          .prepare('UPDATE access_tokens SET revoked_at=?,encrypted_proof=NULL')
          .run(c.clock());
      };
      return held;
    };
    expect((await c.post('metadata-jobs', { ...body, dryRun: false }, headers)).statusCode).toBe(
      401,
    );
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()!.n,
    ).toBe(0);
  } finally {
    await c.cleanup();
  }
});

it('allows explicit session automation while retaining the legacy editor reservation boundary', async () => {
  const c = await createCurationMutationContext();
  try {
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = await c.post('curation-claims', {
      operationId: randomUUID(),
      purpose: 'required_review',
      fields: ['title'],
      targets,
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().results[0].status).toBe('granted');
    const legacy = {
      operationId: randomUUID(),
      targets,
      patch: { title: { op: 'set', value: 'Session-approved synthetic title' } },
    };
    expect((await c.post('metadata-jobs', legacy)).statusCode).toBe(409);
    const accepted = await c.post('metadata-jobs', {
      ...legacy,
      automation: {
        claimId: claim.json().claimId,
        claimGeneration: 1,
        purpose: 'required_review',
        sourceNotes: null,
      },
      dryRun: false,
    });
    expect(accepted.statusCode).toBe(202);
    expect(
      c.storage.db.connection
        .prepare('SELECT actor_session_id,actor_token_id FROM metadata_items')
        .get(),
    ).toMatchObject({ actor_session_id: expect.any(String), actor_token_id: null });
  } finally {
    await c.cleanup();
  }
});
