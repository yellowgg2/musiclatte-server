import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCurationMutationContext } from '../../../tests/support/curation-mutation-harness.js';
it('rejects fabricated absence for present fields and requires a supported optional claim', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const revision = c.repository.get(c.trackRef)!.fileRevision!;
    const claim = (
      await c.post(
        'curation-claims',
        {
          operationId: randomUUID(),
          purpose: 'optional_enrichment',
          fields: ['album'],
          targets: [{ trackId: 'track-1', expectedRevision: revision }],
        },
        headers,
      )
    ).json();
    const request = {
      operationId: randomUUID(),
      claimId: claim.claimId,
      claimGeneration: 1,
      expectedRevision: revision,
      field: 'album',
      status: 'unavailable',
      reason: 'No permitted source',
      sourceNotes: null,
    };
    expect((await c.post('tracks/track-1/metadata-attempts', request, headers)).statusCode).toBe(
      409,
    );
    expect(
      (await c.post('tracks/track-1/metadata-attempts', { ...request, completed: true }, headers))
        .statusCode,
    ).toBe(400);
  } finally {
    await c.cleanup();
  }
});

it('clears only the requested tag, adopts its own successful job and records absence once', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    c.repository.complete(
      c.trackRef,
      { username: 'fixture', credentialKind: 'session', tokenId: null, clientLabel: null },
      null,
    );
    const receipt = c.repository.get(c.trackRef)!.receipt;
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = (
      await c.post(
        'curation-claims',
        { operationId: randomUUID(), purpose: 'optional_enrichment', fields: ['album'], targets },
        headers,
      )
    ).json();
    const before = await c.helper.read({ key: 'imports/source.mp3' });
    const body = {
      operationId: randomUUID(),
      targets,
      patch: { album: { op: 'clear' } },
      automation: {
        claimId: claim.claimId,
        claimGeneration: 1,
        purpose: 'optional_enrichment',
        sourceNotes: null,
      },
      dryRun: false,
    };
    expect((await c.post('metadata-jobs', body, headers)).statusCode).toBe(202);
    const { createAutomationTestWorker } =
      await import('../../../tests/support/automation-worker-harness.js');
    const w = createAutomationTestWorker(c, true);
    expect(await w.worker.runOnce()).toBe(true);
    const after = await c.helper.read({ key: 'imports/source.mp3' });
    expect(after.values).toEqual({ ...before.values, album: null });
    expect(after.lyricsFrames).toEqual(before.lyricsFrames);
    expect(after.audio.packetHash).toBe(before.audio.packetHash);
    await c.reconciler.reconcile(c.trackRef);
    expect(c.repository.get(c.trackRef)!.curationStatus).toBe('completed');
    expect(c.repository.get(c.trackRef)!.receipt).toEqual(receipt);
    const renewed = await c.post(
      `curation-claims/${claim.claimId}/renew`,
      { operationId: randomUUID(), expectedGeneration: 1 },
      headers,
    );
    expect(renewed.statusCode).toBe(200);
    const attempt = {
      operationId: randomUUID(),
      claimId: claim.claimId,
      claimGeneration: 2,
      expectedRevision: c.repository.get(c.trackRef)!.fileRevision!,
      field: 'album',
      status: 'unavailable',
      reason: 'No permitted album information found',
      sourceNotes: null,
    };
    const saved = await c.post('tracks/track-1/metadata-attempts', attempt, headers);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().fieldState.status).toBe('unavailable');
    c.setNow(c.clock() + 1000);
    expect((await c.post('tracks/track-1/metadata-attempts', attempt, headers)).json()).toEqual(
      saved.json(),
    );
    expect((await c.helper.read({ key: 'imports/source.mp3' })).fullDigest).toBe(after.fullDigest);
    expect(c.repository.get(c.trackRef)!.curationStatus).toBe('completed');
  } finally {
    await c.cleanup();
  }
});
