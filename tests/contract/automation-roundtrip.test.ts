import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  decodeCurationCompletion,
  decodeCurationList,
  decodeAutomationDryRun,
  decodeAutomationJobResponse,
  decodeMetadataAttemptResponse,
  decodeCapabilities,
} from '@musiclatte/contracts';
import { createCurationMutationContext } from '../support/curation-mutation-harness.js';
import { createAutomationTestWorker } from '../support/automation-worker-harness.js';
it('roundtrips HTTP tokens, claims, real MP3 jobs, completion and missing lyrics evidence', async () => {
  const c = await createCurationMutationContext();
  try {
    const base = await c.app.listen({ host: '127.0.0.1', port: 0 });
    const issued = await fetch(base + '/api/v1/access-tokens', {
      method: 'POST',
      headers: c.headers,
      body: JSON.stringify({
        name: 'Synthetic roundtrip',
        scopes: ['metadata:read', 'metadata:write', 'lyrics:write', 'curation:write'],
        libraryIds: ['music'],
        expiresAt: c.clock() + 100000,
      }),
    });
    expect(issued.status).toBe(201);
    const headers = {
      authorization: 'Bearer ' + (await issued.json()).token,
      'content-type': 'application/json',
    };
    const post = (path: string, body: object) =>
      fetch(base + '/api/v1/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const get = async (path: string) => {
      const r = await fetch(base + '/api/v1/' + path, { headers });
      expect(r.status).toBe(200);
      return r.json();
    };
    expect((await get('metadata-policy')).policy.requiredFields).toEqual(['title', 'artist']);
    const page = decodeCurationList(await get('tracks'));
    expect(page.total).toBe(1);
    let revision = page.tracks[0]!.fileRevision!;
    const target = () => [{ trackId: 'track-1', expectedRevision: revision }];
    const claim = await (
      await post('curation-claims', {
        operationId: randomUUID(),
        purpose: 'required_review',
        fields: ['title', 'artist'],
        targets: target(),
      })
    ).json();
    const request = {
      operationId: randomUUID(),
      targets: target(),
      patch: { title: { op: 'set', value: 'Reviewed roundtrip fixture' } },
      automation: {
        claimId: claim.claimId,
        claimGeneration: 1,
        purpose: 'required_review',
        sourceNotes: null,
      },
      dryRun: true,
    };
    expect(
      decodeAutomationDryRun(await (await post('metadata-jobs', request)).json()).results[0]!
        .status,
    ).toBe('changed');
    const w = createAutomationTestWorker(c, true);
    const accepted = decodeAutomationJobResponse(
      await (await post('metadata-jobs', { ...request, dryRun: false })).json(),
    );
    expect(await w.worker.runOnce()).toBe(true);
    const job = decodeAutomationJobResponse(await get('metadata-jobs/' + accepted.job!.id));
    expect(job.job!.items[0]!.stage).toBe('succeeded');
    revision = job.job!.items[0]!.resultRevision!;
    const actual = await c.helper.read({ key: 'imports/source.mp3' });
    Object.assign(c.songs[0]!, {
      title: actual.values.title,
      artist: actual.values.artist[0],
      album: actual.values.album,
    });
    const complete = {
      operationId: randomUUID(),
      claimId: claim.claimId,
      claimGeneration: 1,
      expectedRevision: revision,
      policyVersion: 'required-v1',
      sourceNotes: 'Explicit review',
    };
    const completedResponse = await post('tracks/track-1/curation/complete', complete);
    expect(completedResponse.status).toBe(200);
    const completed = decodeCurationCompletion(await completedResponse.json());
    expect(
      decodeCurationCompletion(
        await (await post('tracks/track-1/curation/complete', complete)).json(),
      ),
    ).toEqual(completed);
    const optional = await (
      await post('curation-claims', {
        operationId: randomUUID(),
        purpose: 'optional_enrichment',
        fields: ['lyrics'],
        targets: target(),
      })
    ).json();
    for (const frame of actual.lyricsFrames) {
      const accepted = await post('metadata-jobs', {
        operationId: randomUUID(),
        targets: target(),
        patch: { lyrics: { op: 'clear', selector: frame.selector } },
        automation: {
          claimId: optional.claimId,
          claimGeneration: 1,
          purpose: 'optional_enrichment',
          sourceNotes: 'Synthetic fixture clear',
        },
        dryRun: false,
      });
      expect(accepted.status).toBe(202);
      const response = decodeAutomationJobResponse(await accepted.json());
      expect(await w.worker.runOnce()).toBe(true);
      revision = decodeAutomationJobResponse(await get('metadata-jobs/' + response.job!.id)).job!
        .items[0]!.resultRevision!;
    }
    await c.reconciler.reconcile(c.trackRef);
    const missing = decodeCurationList(
      await get('tracks?curationStatus=completed&missingField=lyrics'),
    );
    expect(missing.total).toBe(1);
    expect(missing.tracks[0]!.receipt).toEqual(completed.receipt);
    const attempt = await post('tracks/track-1/metadata-attempts', {
      operationId: randomUUID(),
      claimId: optional.claimId,
      claimGeneration: 1,
      expectedRevision: revision,
      field: 'lyrics',
      status: 'unavailable',
      reason: 'No permitted source after explicit fixture clear',
      sourceNotes: null,
    });
    expect(attempt.status).toBe(200);
    expect(decodeMetadataAttemptResponse(await attempt.json()).fieldState.status).toBe(
      'unavailable',
    );
    await c.reconciler.reconcile(c.trackRef);
    const absent = decodeCurationList(
      await get('tracks?curationStatus=completed&field=lyrics&fieldStatus=unavailable'),
    );
    expect(absent.total).toBe(1);
    expect(absent.tracks[0]!.receipt).toEqual(completed.receipt);
    expect(
      (
        await fetch(base + '/api/v1/curation-claims/' + optional.claimId, {
          method: 'DELETE',
          headers: { authorization: headers.authorization },
        })
      ).status,
    ).toBe(204);
    const reviewed = await (
      await post('curation-claims', {
        operationId: randomUUID(),
        purpose: 'required_review',
        fields: ['title', 'artist'],
        targets: target(),
      })
    ).json();
    const unchanged = await post('tracks/track-1/curation/complete', {
      ...complete,
      operationId: randomUUID(),
      claimId: reviewed.claimId,
      expectedRevision: revision,
    });
    expect(unchanged.status).toBe(200);
    expect(decodeCurationCompletion(await unchanged.json()).receipt).toEqual(completed.receipt);
    const capability = await fetch(base + '/api/v1/capabilities', { headers: c.headers });
    const features = decodeCapabilities(await capability.json()).features;
    expect(features['metadata.curation']!.supported).toBe(true);
    expect(features['metadata.curation']!.availability).toBe('temporarily_unavailable');
    expect(features['metadata.lyrics.write']!.supported).toBe(true);
  } finally {
    await c.cleanup();
  }
});
