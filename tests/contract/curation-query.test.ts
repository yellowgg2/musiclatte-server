import { expect, it } from 'vitest';
import {
  decodeCurationPolicy,
  decodeCurationList,
  decodeCurationDetail,
} from '@musiclatte/contracts';
import { createCurationQueryContext } from '../support/curation-query-harness.js';
it('consumes real HTTP curation policy, snapshot and history with strict public decoders', async () => {
  const c = await createCurationQueryContext();
  try {
    const headers = await c.token();
    const url = await c.app.listen({ host: '127.0.0.1', port: 0 });
    const policy = await fetch(url + '/api/v1/metadata-policy', { headers });
    expect(policy.status).toBe(200);
    expect(decodeCurationPolicy((await policy.json()).policy).policyVersion).toBe('required-v1');
    const list = await fetch(url + '/api/v1/tracks?missingField=lyrics', { headers });
    expect(list.headers.get('cache-control')).toContain('no-store');
    const page = decodeCurationList(await list.json());
    expect(page.total).toBe(1);
    expect(() => decodeCurationList({ ...page, hostPath: '/private' })).toThrow();
    const detail = decodeCurationDetail(
      await (await fetch(url + '/api/v1/tracks/a/curation', { headers })).json(),
    );
    expect(detail.track.receipt?.verifiedRevision).toBe('r1');
    expect(detail.track.lyricsState).toBe(detail.track.fieldStates.lyrics.status);
    expect(() =>
      decodeCurationDetail({
        ...detail,
        activeWork: [{ itemId: 'i', jobId: 'j', stage: 'file_saved', succeeded: true }],
      }),
    ).toThrow();
  } finally {
    await c.cleanup();
  }
});
