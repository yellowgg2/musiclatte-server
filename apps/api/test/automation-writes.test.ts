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

it('writes original lyrics through the P4 worker after token revocation and lease expiry', async () => {
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
    c.storage.db.connection
      .prepare('UPDATE access_tokens SET revoked_at=?,encrypted_proof=NULL')
      .run(c.clock());
    c.setNow(c.clock() + 1000);
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
