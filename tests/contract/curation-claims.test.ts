import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decodeCurationClaimResult, decodeCurationClaimRenewed } from '@musiclatte/contracts';
import { createCurationMutationContext } from '../support/curation-mutation-harness.js';
it('consumes claim, renewal and release over HTTP and rejects open request/response shapes', async () => {
  const c = await createCurationMutationContext();
  try {
    const headers = await c.token();
    const url = await c.app.listen({ host: '127.0.0.1', port: 0 });
    const body = {
      operationId: randomUUID(),
      purpose: 'required_review',
      fields: ['title'],
      targets: [
        { trackId: 'track-1', expectedRevision: c.repository.get(c.trackRef)!.fileRevision },
      ],
    };
    const post = (route: string, value: object) =>
      fetch(url + '/api/v1/' + route, { method: 'POST', headers, body: JSON.stringify(value) });
    expect((await post('curation-claims', { ...body, actor: 'forged' })).status).toBe(400);
    const response = await post('curation-claims', body);
    expect(response.status).toBe(200);
    const claim = decodeCurationClaimResult(await response.json());
    expect(claim.results[0]?.status).toBe('granted');
    expect(() => decodeCurationClaimResult({ ...claim, filePath: '/private' })).toThrow();
    expect((await post('curation-claims', { ...body, fields: ['artist'] })).status).toBe(409);
    const renew = await post(`curation-claims/${claim.claimId}/renew`, {
      operationId: randomUUID(),
      expectedGeneration: claim.generation,
    });
    expect(renew.status).toBe(200);
    expect(decodeCurationClaimRenewed(await renew.json()).generation).toBe(2);
    expect(
      (
        await fetch(url + '/api/v1/curation-claims/' + claim.claimId, {
          method: 'DELETE',
          headers: { authorization: headers.authorization },
        })
      ).status,
    ).toBe(204);
    expect(decodeCurationClaimResult(await (await post('curation-claims', body)).json())).toEqual(
      claim,
    );
  } finally {
    await c.cleanup();
  }
});
