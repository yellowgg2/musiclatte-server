import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { randomUUID } from 'node:crypto';
import { createCurationMutationContext } from '../../../tests/support/curation-mutation-harness.js';

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
