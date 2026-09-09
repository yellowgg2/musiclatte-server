/** Isolated synthetic library only. Addresses and credentials are read exclusively from a private file. */
import { readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { cookieOf, createTestContext } from './auth-harness.js';
const path = process.env.MUSICLATTE_P7_PRIVATE_CONFIG;
if (!path || (statSync(path).mode & 0o777) !== 0o600)
  throw new Error('Private 0600 configuration required');
const c = JSON.parse(readFileSync(path, 'utf8')) as {
  upstream: string;
  username: string;
  password: string;
  version: string;
  digest: string;
};
assert.equal(c.version, 'v0.22.0');
assert.equal(c.digest, 'sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49');
const salt = randomBytes(12).toString('hex');
async function read(operation: string) {
  const url = new URL('/rest/' + operation, c.upstream);
  for (const [k, v] of Object.entries({
    u: c.username,
    t: createHash('md5')
      .update(c.password + salt)
      .digest('hex'),
    s: salt,
    c: 'p7-probe',
    v: '1.16.1',
    f: 'json',
    size: '10',
  }))
    url.searchParams.set(k, v);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json())['subsonic-response'];
}
const ping = await read('ping');
assert.equal(ping.serverVersion, '0.22.0');
const ext = await read('getOpenSubsonicExtensions');
assert(
  ext.openSubsonicExtensions.some(
    (e: { name: string; versions: number[] }) =>
      e.name === 'transcodeOffset' && e.versions.includes(1),
  ),
);
const raw = await read('getRandomSongs');
const songs = raw.randomSongs.song as {
  id: string;
  suffix: string;
  bitRate: number;
  duration: number;
}[];
assert.equal(songs.length, 3);
assert(songs.some((s) => s.bitRate <= 128));
assert(songs.some((s) => s.suffix === 'flac' && s.bitRate > 128));
const context = await createTestContext({
  upstream: c.upstream,
  streamQuality: true,
  timeoutMs: 15000,
});
try {
  const login = await context.login(undefined, {
    kind: 'password',
    username: c.username,
    password: c.password,
  });
  assert.equal(login.statusCode, 201);
  const headers = { cookie: cookieOf(login) };
  const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
  const evidence = [];
  for (const song of songs) {
    const path = `/api/v1/media/songs/${encodeURIComponent(song.id)}`;
    const plan = await context.app.inject({ url: path + '/playback?quality=economy', headers });
    assert.equal(plan.statusCode, 200);
    assert.equal(plan.json().effectiveQuality, song.bitRate <= 128 ? 'original' : 'economy');
    const original = await context.app.inject({
      method: 'HEAD',
      url: path + '/stream?quality=original',
      headers,
    });
    assert.equal(original.statusCode, 200);
    const range = await context.app.inject({
      url: path + '/stream?quality=original',
      headers: { ...headers, range: 'bytes=0-1023' },
    });
    assert.equal(range.statusCode, 206);
    const conditional = await context.app.inject({
      url: path + '/stream?quality=original',
      headers: { ...headers, 'if-none-match': String(original.headers.etag) },
    });
    assert.equal(conditional.statusCode, 304);
    const invalidRange = await context.app.inject({
      url: path + '/stream?quality=original',
      headers: { ...headers, range: 'bytes=999999999-' },
    });
    assert.equal(invalidRange.statusCode, 416);
    const entry: Record<string, unknown> = {
      codec: song.suffix,
      bitRate: song.bitRate,
      seek: plan.json().seekMode,
      rawHead: original.statusCode,
      rawRange: range.statusCode,
      conditional: conditional.statusCode,
      invalidRange: invalidRange.statusCode,
    };
    if (song.bitRate > 128) {
      const url = address + plan.json().streamPath;
      const cold = await fetch(url, { headers: { ...headers, range: 'bytes=0-1023' } });
      assert.equal(cold.status, 200);
      assert.equal(cold.headers.get('content-type'), 'audio/mpeg');
      entry.cold = {
        status: cold.status,
        chunked: cold.headers.get('transfer-encoding') === 'chunked',
        codec: 'mp3',
      };
      await cold.arrayBuffer();
      const warm = await fetch(url, { headers: { ...headers, range: 'bytes=0-1023' } });
      assert.equal(warm.status, 206);
      await warm.arrayBuffer();
      entry.warm = warm.status;
      const offset = await fetch(url + '&offset=30', {
        headers: { ...headers, range: 'bytes=999-1023' },
      });
      assert.equal(offset.status, 200);
      const offsetBytes = (await offset.arrayBuffer()).byteLength;
      assert(offsetBytes > 0);
      entry.offset = { status: offset.status, bytes: offsetBytes };
      const controller = new AbortController();
      const aborted = await fetch(url + '&offset=17', { headers, signal: controller.signal });
      await aborted.body!.getReader().read();
      controller.abort();
      entry.abort = controller.signal.aborted;
    }
    evidence.push(entry);
  }
  console.info(
    JSON.stringify({
      version: c.version,
      digest: c.digest,
      transcodeOffset: true,
      streams: evidence,
    }),
  );
} finally {
  await context.cleanup();
}
