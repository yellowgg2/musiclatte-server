import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCurationMutationContext } from '../../../tests/support/curation-mutation-harness.js';
async function completionContext(write = false) {
  const c = await createCurationMutationContext();
  const snapshot = await c.helper.read({ key: 'imports/source.mp3' });
  Object.assign(c.songs[0]!, {
    title: snapshot.values.title,
    artist: snapshot.values.artist[0],
    album: snapshot.values.album,
  });
  const headers = await c.token(
    write
      ? ['metadata:read', 'metadata:write', 'lyrics:write', 'curation:write']
      : ['metadata:read', 'curation:write'],
  );
  const revision = c.repository.get(c.trackRef)!.fileRevision!;
  const claim = (
    await c.post(
      'curation-claims',
      {
        operationId: randomUUID(),
        purpose: 'required_review',
        fields: ['title', 'artist'],
        targets: [{ trackId: 'track-1', expectedRevision: revision }],
      },
      headers,
    )
  ).json();
  const body = {
    operationId: randomUUID(),
    claimId: claim.claimId,
    claimGeneration: 1,
    expectedRevision: revision,
    policyVersion: 'required-v1',
    sourceNotes: 'Reviewed original synthetic tags',
  };
  return { ...c, headers, body };
}
it('completes an unchanged verified file without a job, replays the same receipt and preserves history on reopen', async () => {
  const c = await completionContext();
  try {
    const result = await c.post('tracks/track-1/curation/complete', c.body, c.headers);
    expect(result.statusCode).toBe(200);
    expect(result.json().curation.curationStatus).toBe('completed');
    expect(result.json().receipt.completedBy).toMatchObject({
      credentialKind: 'access_token',
      tokenId: expect.any(String),
    });
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM metadata_jobs').get()!.n,
    ).toBe(0);
    c.setNow(c.clock() + 1000);
    expect((await c.post('tracks/track-1/curation/complete', c.body, c.headers)).json()).toEqual(
      result.json(),
    );
    expect(
      (
        await c.post(
          'tracks/track-1/curation/complete',
          { ...c.body, sourceNotes: 'Changed' },
          c.headers,
        )
      ).statusCode,
    ).toBe(409);
    const reopen = await c.post(
      'tracks/track-1/curation/reopen',
      {
        operationId: randomUUID(),
        expectedRevision: c.body.expectedRevision,
        reason: 'Review again',
      },
      c.headers,
    );
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().curation.curationStatus).toBe('needs_review');
    expect(reopen.json().curation.receipt).toEqual(result.json().receipt);
  } finally {
    await c.cleanup();
  }
});
it('rejects stale policy, stale file, forged actor, and index mismatch with typed reasons', async () => {
  const c = await completionContext();
  try {
    const post = (extra: object) =>
      c.post('tracks/track-1/curation/complete', { ...c.body, ...extra }, c.headers);
    expect((await post({ policyVersion: 'old-policy' })).json().error.reason).toBe(
      'policy_changed',
    );
    expect((await post({ expectedRevision: 'old-revision' })).json().error.reason).toBe(
      'revision_conflict',
    );
    expect((await post({ completedBy: 'forged' })).statusCode).toBe(400);
    c.songs[0]!.title = 'Stale index';
    expect((await post({})).json().error.reason).toBe('reflection_pending');
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM curation_receipts').get()!.n,
    ).toBe(0);
  } finally {
    await c.cleanup();
  }
});

it('serializes concurrent completion and exposes a changed policy as needs_review without rewriting receipts', async () => {
  const c = await completionContext();
  try {
    const results = await Promise.all([
      c.post('tracks/track-1/curation/complete', c.body, c.headers),
      c.post(
        'tracks/track-1/curation/complete',
        { ...c.body, operationId: randomUUID() },
        c.headers,
      ),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM curation_receipts').get()!.n,
    ).toBe(1);
    c.storage.db.connection
      .prepare("UPDATE curation_tracks SET policy_version='old-policy' WHERE id=?")
      .run(c.trackRef);
    expect(c.repository.get(c.trackRef)).toMatchObject({
      curationStatus: 'needs_review',
      validation: 'stale',
      receipt: { policyVersion: 'required-v1' },
    });
  } finally {
    await c.cleanup();
  }
});
it('blocks accepted pending work and explicitly verifies unchanged original bytes after a pre-publish failure', async () => {
  const c = await completionContext(true);
  try {
    const result = await c.post(
      'metadata-jobs',
      {
        operationId: randomUUID(),
        targets: [{ trackId: 'track-1', expectedRevision: c.body.expectedRevision }],
        patch: { title: { op: 'set', value: 'Never published title' } },
        automation: {
          claimId: c.body.claimId,
          claimGeneration: 1,
          purpose: 'required_review',
          sourceNotes: null,
        },
        dryRun: false,
      },
      c.headers,
    );
    expect(result.statusCode).toBe(202);
    expect(
      (await c.post('tracks/track-1/curation/complete', c.body, c.headers)).json().error.reason,
    ).toBe('pending_job');
    const { createMetadataRepository } = await import('../src/storage/metadata-repository.js');
    const jobs = createMetadataRepository({ database: c.storage.db, clock: c.clock });
    const workerClaim = jobs.claimNext({ workerId: 'synthetic-failure', leaseDurationMs: 10000 })!;
    jobs.transition({ ...workerClaim, stage: 'failed', errorCode: 'prepare_failed' });
    const completion = await c.post('tracks/track-1/curation/complete', c.body, c.headers);
    expect(completion.statusCode).toBe(200);
    expect(completion.json().curation.title).not.toBe('Never published title');
    expect(
      c.storage.db.connection
        .prepare("SELECT count(*) AS n FROM curation_events WHERE kind='failed_intent_not_applied'")
        .get()!.n,
    ).toBe(1);
  } finally {
    await c.cleanup();
  }
});
it('detects an external file change at the final fence validation and never commits a receipt', async () => {
  const c = await completionContext();
  try {
    const { appendFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const withFence = c.fence.withMediaFence.bind(c.fence);
    let changed = false;
    c.fence.withMediaFence = (fileIdentity, purpose, work) =>
      withFence(fileIdentity, purpose, async (held) => {
        const validate = held.validate.bind(held);
        held.validate = async () => {
          await validate();
          appendFileSync(join(c.root, 'source.mp3'), 'external synthetic change');
          changed = true;
        };
        return work(held);
      });
    const response = await c.post('tracks/track-1/curation/complete', c.body, c.headers);
    expect(changed).toBe(true);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.reason).toBe('revision_conflict');
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS n FROM curation_receipts').get()!.n,
    ).toBe(0);
  } finally {
    await c.cleanup();
  }
});
it('requires real nonempty title/artist even when an index fallback looks populated', async () => {
  const c = await completionContext();
  try {
    const { copyFileSync, renameSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = join(c.root, 'source.mp3');
    const candidate = join(c.root, 'clear.metadata-pending');
    copyFileSync(source, candidate);
    const snapshot = await c.helper.read({ key: 'imports/source.mp3' });
    await c.helper.prepare({
      candidateKey: 'imports/clear.metadata-pending',
      expectedDigest: snapshot.fullDigest,
      patch: { title: { op: 'clear' } },
    });
    renameSync(candidate, source);
    await c.app.inject({
      method: 'DELETE',
      url: '/api/v1/curation-claims/' + c.body.claimId,
      headers: { authorization: c.headers.authorization },
    });
    await c.reconciler.reconcile(c.trackRef);
    const revision = c.repository.get(c.trackRef)!.fileRevision!;
    const claim = (
      await c.post(
        'curation-claims',
        {
          operationId: randomUUID(),
          purpose: 'required_review',
          fields: ['title', 'artist'],
          targets: [{ trackId: 'track-1', expectedRevision: revision }],
        },
        c.headers,
      )
    ).json();
    const response = await c.post(
      'tracks/track-1/curation/complete',
      { ...c.body, claimId: claim.claimId, expectedRevision: revision },
      c.headers,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.reason).toBe('required_fields_missing');
  } finally {
    await c.cleanup();
  }
});

it('waits for an interrupted import publication while leaving its owner able to recover', async () => {
  const c = await completionContext();
  try {
    const event = c.seed();
    const db = c.storage.db.connection;
    const importItem = String(
      db.prepare('SELECT import_item_id FROM download_events WHERE id=?').get(event.id)!
        .import_item_id,
    );
    db.prepare("UPDATE import_items SET stage='publishing' WHERE id=?").run(importItem);
    const fileIdentity = String(c.repository.rowFor(c.trackRef)!.file_identity);
    db.prepare('UPDATE media_publications SET publication_id=?,dirty=1 WHERE file_identity=?').run(
      importItem,
      fileIdentity,
    );
    const result = await c.post('tracks/track-1/curation/complete', c.body, c.headers);
    expect(result.statusCode).toBe(409);
    expect(result.json().error.reason).toBe('pending_job');
    expect(db.prepare('SELECT count(*) AS n FROM curation_receipts').get()!.n).toBe(0);
  } finally {
    await c.cleanup();
  }
});
