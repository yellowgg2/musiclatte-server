import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  decodeAutomationDryRun,
  decodeAutomationJobResponse,
  decodeMetadataJob,
} from '@musiclatte/contracts';
import { createCurationMutationContext } from '../support/curation-mutation-harness.js';
import { createAutomationTestWorker } from '../support/automation-worker-harness.js';
it('consumes automation preview, admission and poll over HTTP while legacy bodies remain session-only', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const base = await c.app.listen({ host: '127.0.0.1', port: 0 });
    const post = (route: string, body: object) =>
      fetch(base + '/api/v1/' + route, { method: 'POST', headers, body: JSON.stringify(body) });
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = await (
      await post('curation-claims', {
        operationId: randomUUID(),
        purpose: 'required_review',
        fields: ['title'],
        targets,
      })
    ).json();
    const legacy = {
      operationId: randomUUID(),
      targets,
      patch: { title: { op: 'set', value: 'New original fixture title' } },
    };
    expect((await post('metadata-jobs', legacy)).status).toBe(403);
    const body = {
      ...legacy,
      automation: {
        claimId: claim.claimId,
        claimGeneration: 1,
        purpose: 'required_review',
        sourceNotes: null,
      },
      dryRun: true,
    };
    const dry = decodeAutomationDryRun(await (await post('metadata-jobs', body)).json());
    expect(dry.results[0]!.status).toBe('changed');
    expect(() => decodeAutomationDryRun({ ...dry, writeGuaranteed: true })).toThrow();
    const accepted = await post('metadata-jobs', { ...body, dryRun: false });
    expect(accepted.status).toBe(202);
    const job = decodeAutomationJobResponse(await accepted.json());
    expect(job.job!.items[0]!.stage).toBe('queued');
    const poll = await fetch(base + '/api/v1/metadata-jobs/' + job.job!.id, { headers });
    expect(poll.status).toBe(200);
    expect(decodeAutomationJobResponse(await poll.json())).toEqual(job);
    expect(() => decodeAutomationJobResponse({ ...job, hostPath: '/private' })).toThrow();
    const rejected = await post('metadata-jobs', {
      ...body,
      operationId: randomUUID(),
      dryRun: false,
      targets: [{ trackId: 'absent', expectedRevision: 'unknown' }],
    });
    expect(rejected.status).toBe(422);
    expect(decodeAutomationJobResponse(await rejected.json()).job).toBeNull();
  } finally {
    await c.cleanup();
  }
});

it('lets a metadata write PAT recheck saved work without requiring a browser session', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const post = (route: string, body: object) => c.post(route, body, headers);
    const targets = [
      { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision! },
    ];
    const claim = await (
      await post('curation-claims', {
        operationId: randomUUID(),
        purpose: 'required_review',
        fields: ['title'],
        targets,
      })
    ).json();
    const accepted = decodeAutomationJobResponse(
      (
        await post('metadata-jobs', {
          operationId: randomUUID(),
          targets,
          patch: { title: { op: 'set', value: 'Saved fixture title' } },
          automation: {
            claimId: claim.claimId,
            claimGeneration: 1,
            purpose: 'required_review',
            sourceNotes: null,
          },
          dryRun: false,
        })
      ).json(),
    );
    const worker = createAutomationTestWorker(c);
    expect(await worker.worker.runOnce()).toBe(true);
    const saved = decodeAutomationJobResponse(
      (await c.app.inject({ url: `/api/v1/metadata-jobs/${accepted.job!.id}`, headers })).json(),
    );
    expect(saved.job!.items[0]!.stage).toBe('file_saved');

    const recheck = await post(`metadata-jobs/${accepted.job!.id}/rechecks`, {
      operationId: randomUUID(),
      itemIds: [accepted.job!.items[0]!.itemId],
    });
    expect(recheck.statusCode).toBe(202);
    expect(decodeMetadataJob(recheck.json().job).items[0]!.stage).toBe('file_saved');
  } finally {
    await c.cleanup();
  }
});
