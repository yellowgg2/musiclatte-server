import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { randomUUID } from 'node:crypto';
import { createCurationMutationContext } from '../../../tests/support/curation-mutation-harness.js';

it('queues stale claim targets for prioritized inventory verification', async () => {
  const c = await createCurationMutationContext();
  try {
    c.storage.db.connection
      .prepare(
        "INSERT INTO curation_inventory_runs(library_id,generation,status,last_discovery_at,checkpoint_json) VALUES(?,?,'discovering',?,'{}')",
      )
      .run('music', 'generation-1', c.clock());
    c.storage.db.connection
      .prepare("UPDATE curation_tracks SET validation='stale' WHERE id=?")
      .run(c.trackRef);
    const response = await c.post(
      'curation-claims',
      {
        operationId: randomUUID(),
        purpose: 'optional_enrichment',
        fields: ['album'],
        targets: [
          { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
        ],
      },
      await c.token(),
    );
    expect(response.json().results).toEqual([{ trackId: 'track-1', status: 'inventory_pending' }]);
    expect(
      c.storage.db.connection
        .prepare(
          "SELECT status FROM curation_inventory_queue WHERE library_id=? AND generation=? AND opaque_id=? AND kind='track'",
        )
        .get('music', 'generation-1', 'track-1')?.status,
    ).toBe('pending');
    expect(
      c.storage.db.connection
        .prepare(
          'SELECT kind FROM curation_source_events WHERE library_id=? AND track_id=? ORDER BY sequence DESC LIMIT 1',
        )
        .get('music', 'track-1')?.kind,
    ).toBe('claim_verification_requested');
  } finally {
    await c.cleanup();
  }
});

it('claims with real file revisions, separates token owners and preserves replay before stale checks', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const other = await c.token();
    const request = {
      operationId: randomUUID(),
      purpose: 'required_review',
      fields: ['title', 'artist'],
      targets: [
        { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
        { trackId: 'absent', expectedRevision: 'unknown' },
      ],
    };
    const first = await c.post('curation-claims', request, headers);
    expect(first.statusCode).toBe(200);
    expect(first.json().results.map((r: { status: string }) => r.status)).toEqual([
      'granted',
      'not_found',
    ]);
    expect(c.repository.get(c.trackRef)?.curationStatus).toBe('in_progress');
    const competing = await c.post(
      'curation-claims',
      { ...request, operationId: randomUUID() },
      other,
    );
    expect(competing.json().results[0].status).toBe('claimed_by_other');
    expect(competing.json().claimId).toBeNull();
    expect(
      (await c.post('curation-claims', { ...request, operationId: randomUUID() }, headers))
        .statusCode,
    ).toBe(409);
    const restarted = createApp(c.options);
    try {
      expect(
        (
          await restarted.inject({
            method: 'POST',
            url: '/api/v1/curation-claims',
            headers,
            payload: request,
          })
        ).json(),
      ).toEqual(first.json());
    } finally {
      await restarted.close();
    }
    c.setNow(c.clock() + 1000);
    expect(c.repository.get(c.trackRef)?.curationStatus).toBe('unreviewed');
    expect((await c.post('curation-claims', request, headers)).json()).toEqual(first.json());
    const claimId = first.json().claimId;
    expect(
      (
        await c.post(
          `curation-claims/${claimId}/renew`,
          { operationId: randomUUID(), expectedGeneration: 1 },
          headers,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/curation-claims/${claimId}`,
          headers: { authorization: other.authorization },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/curation-claims/${claimId}`,
          headers: { authorization: headers.authorization },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await c.app.inject({
          method: 'DELETE',
          url: `/api/v1/curation-claims/${claimId}`,
          headers: { authorization: headers.authorization },
        })
      ).statusCode,
    ).toBe(204);
  } finally {
    await c.cleanup();
  }
});

it('enforces purpose scopes, renew generation and clock rollback while optional work keeps completion', async () => {
  const c = await createCurationMutationContext();
  try {
    c.repository.complete(
      c.trackRef,
      { username: 'fixture', credentialKind: 'session', tokenId: null, clientLabel: null },
      null,
    );
    const request = {
      operationId: randomUUID(),
      purpose: 'optional_enrichment',
      fields: ['lyrics'],
      targets: [
        { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
      ],
    };
    expect(
      (await c.post('curation-claims', request, await c.token(['metadata:read', 'curation:write'])))
        .statusCode,
    ).toBe(403);
    const headers = await c.token();
    const claim = await c.post('curation-claims', request, headers);
    expect(claim.statusCode).toBe(200);
    expect(c.repository.get(c.trackRef)?.curationStatus).toBe('completed');
    const renewal = { operationId: randomUUID(), expectedGeneration: 1 };
    const renewed = await c.post(`curation-claims/${claim.json().claimId}/renew`, renewal, headers);
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().generation).toBe(2);
    expect(
      (await c.post(`curation-claims/${claim.json().claimId}/renew`, renewal, headers)).json(),
    ).toEqual(renewed.json());
    expect(
      (
        await c.post(
          `curation-claims/${claim.json().claimId}/renew`,
          { ...renewal, operationId: randomUUID() },
          headers,
        )
      ).statusCode,
    ).toBe(409);
    const preview = await c.app.inject({
      url: '/api/v1/tracks/track-1/metadata',
      headers: c.headers,
    });
    expect(preview.json().editable).toBe(false);
    c.setNow(c.clock() - 1);
    expect(c.repository.activeClaim(c.trackRef)).toBeUndefined();
  } finally {
    await c.cleanup();
  }
});

/** Optional scalar and array fields can be claimed without the lyrics-only scope. */
it('should claim all non-lyrics optional metadata fields with metadata write authority', async () => {
  const c = await createCurationMutationContext();
  try {
    c.repository.complete(
      c.trackRef,
      { username: 'fixture', credentialKind: 'session', tokenId: null, clientLabel: null },
      null,
    );
    const response = await c.post(
      'curation-claims',
      {
        operationId: randomUUID(),
        purpose: 'optional_enrichment',
        fields: ['albumArtist', 'trackNumber', 'year', 'genre'],
        targets: [
          {
            trackId: 'track-1',
            expectedRevision: c.repository.get(c.trackRef)!.fileRevision!,
          },
        ],
      },
      await c.token(['metadata:read', 'metadata:write']),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([{ trackId: 'track-1', status: 'granted' }]);
    expect(c.repository.get(c.trackRef)?.curationStatus).toBe('completed');
  } finally {
    await c.cleanup();
  }
});

it('allows a successor claim after a file-verified album projection waits for organization', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token(['metadata:read', 'metadata:write']);
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
    const response = await c.post(
      'curation-claims',
      {
        operationId: randomUUID(),
        purpose: 'optional_enrichment',
        fields: ['album'],
        targets: [{ trackId: 'track-1', expectedRevision: track.revision }],
      },
      headers,
    );
    expect(response.json().results).toEqual([{ trackId: 'track-1', status: 'granted' }]);
  } finally {
    await c.cleanup();
  }
});

it('distinguishes stale revision and active file fences without creating permanent reservations', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const request = {
      operationId: randomUUID(),
      purpose: 'required_review',
      fields: ['title'],
      targets: [{ trackId: 'track-1', expectedRevision: 'stale' }],
    };
    expect((await c.post('curation-claims', request, headers)).json().results[0].status).toBe(
      'stale_revision',
    );
    request.operationId = randomUUID();
    request.targets[0]!.expectedRevision = c.repository.get(c.trackRef)!.fileRevision!;
    const lock = await c.fence.acquire(
      String(c.repository.rowFor(c.trackRef)!.file_identity),
      'verify',
    );
    try {
      expect((await c.post('curation-claims', request, headers)).json().results[0].status).toBe(
        'file_busy',
      );
    } finally {
      await lock.release();
    }
    expect(c.repository.activeClaim(c.trackRef)).toBeUndefined();
    const accepted = await c.post(
      'curation-claims',
      { ...request, operationId: randomUUID() },
      headers,
    );
    expect(accepted.json().results[0].status).toBe('granted');
    const preview = await c.app.inject({
      url: '/api/v1/tracks/track-1/metadata',
      headers: c.headers,
    });
    expect(preview.json().reason).toBe('claimed_by_other');
    const legacy = await c.post('metadata-jobs', {
      operationId: randomUUID(),
      targets: request.targets,
      patch: { title: { op: 'set', value: 'New title' } },
    });
    expect(legacy.statusCode).toBe(409);
    const renew = { operationId: randomUUID(), expectedGeneration: 1 };
    const renewRoute = `curation-claims/${accepted.json().claimId}/renew`;
    const competing = await Promise.all([
      c.post(renewRoute, renew, headers),
      c.post(renewRoute, { ...renew, operationId: randomUUID() }, headers),
    ]);
    expect(competing.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    c.storage.db.connection
      .prepare('UPDATE access_tokens SET revoked_at=?,encrypted_proof=NULL')
      .run(c.clock());
    expect((await c.post('curation-claims', request, headers)).statusCode).toBe(401);
  } finally {
    await c.cleanup();
  }
});
