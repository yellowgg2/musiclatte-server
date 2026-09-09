import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createCurationMutationContext } from '../support/curation-mutation-harness.js';
import { createAutomationTestWorker } from '../support/automation-worker-harness.js';
import { password, origin } from '../support/auth-harness.js';
import { runAutomationHTTPClient } from '../../tools/verification/automation-http-client.js';
it('keeps automation opt-in and shares only the fence with all writers', () => {
  const base = readFileSync('compose.yaml', 'utf8');
  expect(base).not.toContain('AUTOMATION_ENABLED');
  const overlay = readFileSync('deploy/compose.automation.yaml', 'utf8');
  expect(overlay.match(/MEDIA_FENCE_ROOT: \/media-fence/g)).toHaveLength(3);
  expect(overlay).not.toContain('metadata-data:');
  expect(overlay).not.toContain('docker.sock');
  const metadata = readFileSync('deploy/compose.metadata.yaml', 'utf8');
  expect(
    metadata.slice(metadata.indexOf('  api:'), metadata.indexOf('\n  metadata-volume-init:')),
  ).toContain('read_only: true');
});
it('runs the source-only HTTP consumer against real routes and MP3 writes', async () => {
  const c = await createCurationMutationContext();
  const now = vi.spyOn(Date, 'now').mockImplementation(c.clock);
  c.automation.maxTokenAgeMs = 3600000;
  const app = createApp({
    ...c.options,
    automation: { ...c.automation, curation: { ...c.automation.curation, ready: () => true } },
  });
  execFileSync(c.metadata.runtime.python, [
    '-c',
    "from mutagen.id3 import ID3;import sys;t=ID3(sys.argv[1]);t.delall('USLT');t.save(sys.argv[1],v2_version=4)",
    join(c.root, 'source.mp3'),
  ]);
  await c.reconciler.reconcile(c.trackRef);
  const credential = join(realpathSync(c.storage.root), 'client-credential.json');
  writeFileSync(
    credential,
    JSON.stringify({ username: password.username, password: password.password }),
    { mode: 0o600 },
  );
  const worker = createAutomationTestWorker(c, true);
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      await worker.worker.runOnce();
      const actual = await c.helper.read({ key: 'imports/source.mp3' });
      Object.assign(c.songs[0]!, {
        title: actual.values.title,
        artist: actual.values.artist[0],
        album: actual.values.album,
      });
      await delay(20);
    }
  })();
  try {
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const result = await runAutomationHTTPClient({
      api: base + '/api/v1',
      origin,
      upstream: base,
      credentialPath: credential,
      libraryId: 'music',
      fixtureTitle: 'unused',
      trackId: 'track-1',
    });
    expect(result).toMatchObject({
      http: true,
      partialAdmission: true,
      replay: true,
      completed: true,
      optionalPreserved: true,
      revocation: true,
    });
  } finally {
    stopped = true;
    await loop;
    now.mockRestore();
    await app.close();
    await c.cleanup();
  }
}, 30000);
