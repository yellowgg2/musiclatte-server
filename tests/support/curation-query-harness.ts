import { createAccessTokenTestContext } from './access-token-harness.js';
import { createApp } from '../../apps/api/src/app.js';
import { createCurationRepository } from '../../apps/api/src/storage/curation-repository.js';
export async function createCurationQueryContext() {
  const c = await createAccessTokenTestContext();
  const limits = {
    claimLeaseMs: 1000,
    maxTargets: 10,
    snapshotMaxAgeMs: 500,
    snapshotMaxItems: 100,
    snapshotMaxCount: 20,
  };
  const automation = { ...c.automation, curation: { limits } };
  const options = { ...c.options, automation };
  const app = createApp(options);
  const repository = createCurationRepository({
    database: c.storage.db,
    clock: automation.clock,
    cursorKey: c.options.signingKey,
    limits,
  });
  const ids = ['a', 'b'].map((trackId) =>
    repository.discover({
      libraryId: 'library-1',
      trackId,
      format: 'mp3',
      fileIdentity: trackId.repeat(64),
    }),
  );
  repository.observe(ids[0]!, {
    revision: 'r1',
    requiredFingerprint: 'required',
    audioIdentity: 'audio',
    policyVersion: 'required-v1',
    trusted: true,
    title: 'Synthetic',
    artist: ['Artist'],
    fields: { title: true, artist: true, album: true, cover: false, lyrics: false },
    changedFields: ['title', 'artist', 'album', 'cover', 'lyrics'],
  });
  repository.complete(
    ids[0]!,
    { username: 'fixture-listener', credentialKind: 'session', tokenId: null, clientLabel: null },
    null,
  );
  async function token() {
    const issued = await app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: c.headers,
      payload: c.payload,
    });
    if (issued.statusCode !== 201) throw new Error('fixture_token_failed');
    return { authorization: `Bearer ${issued.json().token}` };
  }
  return {
    ...c,
    app,
    options,
    automation,
    repository,
    ids,
    token,
    cleanup: async () => {
      await app.close();
      await c.cleanup();
    },
  };
}
