/** Real normal-route runtime with original two-second synthetic PCM audio. */
import { readFileSync } from 'node:fs';
import { createApp } from '../../apps/api/src/app.js';
import { createSessionService } from '../../apps/api/src/auth/session-service.js';
import { createListeningRepository } from '../../apps/api/src/storage/listening-repository.js';
import { createTestContext, password } from './auth-harness.js';
const port = Number(process.env.PORT);
const webPort = Number(process.env.WEB_PORT);
if (![port, webPort].every((value) => Number.isInteger(value) && value > 1024 && value < 65536))
  throw new Error('Explicit preview ports required');
const c = await createTestContext();
c.storage.setNow(Date.now());
c.state.songDurationOverride = 2;
c.state.accountIdentityFromProof = true;
const repository = createListeningRepository({ database: c.storage.db, clock: Date.now });
const options = {
  ...c.options,
  origin: `http://127.0.0.1:${webPort}`,
  secureCookies: false,
  sessions: c.storage.sessionsFor(c.storage.db, 3600000),
  listening: { repository, scrobble: true, clock: Date.now },
};
const app = createApp(options);
const service = createSessionService(options);
let previous = '';
let seeded = false;
const timer = setInterval(() => {
  c.storage.setNow(Date.now());
  let mode = '';
  try {
    if (process.env.PREVIEW_CONTROL)
      mode = readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim();
  } catch {}
  c.state.songError = mode === 'missing' ? 70 : 0;
  c.state.songStatus = mode === 'error' ? 503 : 0;
  c.state.scrobbleDrop = mode === 'uncertain';
  c.state.scrobbleError = mode === 'unauthorized' ? 40 : 0;
  c.state.songStall = mode === 'loading';
  if (mode === 'seed' && !seeded) {
    seeded = true;
    const identityKey = Buffer.from(
      service.sign(
        'listening-identity',
        JSON.stringify([c.storage.instances.get().id, password.username]),
      ),
      'base64url',
    ).toString('hex');
    for (let i = 0; i < 52; i++) {
      const time = Date.now() - (i % 2 ? 8 : 1) * 86400000;
      repository.insert(
        {
          identityKey,
          eventIdHash: i.toString(16).padStart(64, '0'),
          requestHash: 'e'.repeat(64),
          songId: 'tr-1',
          startedAt: time - 2000,
          qualifiedAt: time,
        },
        true,
      );
    }
  }
  if (mode === 'record-error' && previous !== mode)
    c.storage.db.connection.exec(
      "CREATE TRIGGER fail_listening_preview BEFORE INSERT ON listening_events BEGIN SELECT RAISE(ABORT,'Synthetic recording failure'); END",
    );
  if (mode !== 'record-error' && previous === 'record-error')
    c.storage.db.connection.exec('DROP TRIGGER fail_listening_preview');
  previous = mode;
}, 100);
await app.listen({ host: '127.0.0.1', port });
console.info(`Listening preview ready on 127.0.0.1:${port}`);
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await app.close();
  await c.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
