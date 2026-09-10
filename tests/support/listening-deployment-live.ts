/** Private-config live probe for the opt-in Phase 7 deployment. */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const path = process.env.MUSICLATTE_P7_PRIVATE_CONFIG;
if (!path || (statSync(path).mode & 0o077) !== 0) throw new Error('Private config must be 0600');
const config = JSON.parse(readFileSync(path, 'utf8')) as {
  gateway: string;
  origin: string;
  upstream: string;
  username: string;
  password: string;
  project: string;
};
if (!/^musiclatte-p7-s13-[a-z0-9-]+$/.test(config.project)) throw new Error('Unowned project');

let cookie = '';
let csrf = '';
async function api(route: string, method = 'GET', body?: object) {
  const response = await fetch(config.gateway + route, {
    method,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? {
            'Content-Type': 'application/json',
            Origin: config.origin,
            'X-Musiclatte-Client': 'web',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status} ${route}`);
  return { response, value };
}
async function gonic(operation: string, entries: Record<string, string> = {}) {
  const salt = randomBytes(8).toString('hex');
  const query = new URLSearchParams({
    u: config.username,
    s: salt,
    t: createHash('md5')
      .update(config.password + salt)
      .digest('hex'),
    v: '1.15.0',
    c: 'musiclatte-p7-live',
    f: 'json',
    ...entries,
  });
  const response = await fetch(`${config.upstream}/rest/${operation}?${query}`);
  const envelope = (await response.json())['subsonic-response'];
  if (!response.ok || envelope.status !== 'ok') throw new Error(`Gonic ${operation} failed`);
  return envelope;
}
async function stream(path: string) {
  const response = await fetch(config.gateway + path, {
    headers: { Cookie: cookie, Range: 'bytes=0-1023' },
  });
  return response.ok && (await response.arrayBuffer()).byteLength > 0;
}

const login = await api('/api/v1/session', 'POST', {
  kind: 'password',
  username: config.username,
  password: config.password,
});
cookie = login.response.headers.get('set-cookie')?.split(';')[0] ?? '';
csrf = String(login.value.csrfToken ?? '');
if (!cookie || !csrf) throw new Error('Login did not create browser credentials');
const capabilities = (await api('/api/v1/capabilities')).value.features;
for (const key of ['mixes.saved', 'listening.history', 'music.streamQuality', 'music.artistInfo'])
  if (capabilities[key]?.supported !== true) throw new Error(`Missing ${key}`);

await api('/api/v1/scan', 'POST', {});
for (let index = 0; index < 30; index++) {
  if (!(await api('/api/v1/scan')).value.scanning) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const songs = (await api('/api/v1/music/random?size=2')).value.songs as Array<{
  id: string;
  artistId?: string;
  bitRate?: number;
}>;
if (songs.length < 2) throw new Error('Synthetic songs missing');
const song = songs.find((candidate) => (candidate.bitRate ?? 0) > 128) ?? songs[0]!;
const playCountBefore = Number((await gonic('getSong', { id: song.id })).song.playCount ?? 0);

const mix = (
  await api('/api/v1/mixes', 'POST', {
    operationId: randomBytes(16).toString('base64url'),
    name: 'Synthetic deployment mix',
    conditions: { size: 2 },
  })
).value.mix;
await api(`/api/v1/mixes/${encodeURIComponent(mix.id)}/songs`);

const now = Date.now();
const event = {
  eventId: randomBytes(16).toString('base64url'),
  songId: song.id,
  startedAt: new Date(now - 8000).toISOString(),
  qualifiedAt: new Date(now - 1000).toISOString(),
  listenedMs: 7000,
};
const first = (await api('/api/v1/listening/events', 'POST', event)).value;
const replay = (await api('/api/v1/listening/events', 'POST', event)).value;
if (JSON.stringify(first) !== JSON.stringify(replay)) throw new Error('Replay changed receipt');
const history = (await api('/api/v1/listening/history')).value.items;
const top = (await api('/api/v1/listening/top-songs')).value.items;
const plan = (
  await api(`/api/v1/media/songs/${encodeURIComponent(song.id)}/playback?quality=economy`)
).value;
if (!(await stream(plan.streamPath)) || !(await stream(plan.streamPath)))
  throw new Error('Economy stream failed');
if (plan.seekMode === 'offset' && !(await stream(`${plan.streamPath}&offset=1`)))
  throw new Error('Economy seek failed');
if (song.artistId) await api(`/api/v1/music/artists/${encodeURIComponent(song.artistId)}/info`);
await new Promise((resolve) => setTimeout(resolve, 200));
const playCountAfter = Number((await gonic('getSong', { id: song.id })).song.playCount ?? 0);
if (playCountAfter - playCountBefore !== 1) throw new Error('Unexpected play count delta');
console.log(
  JSON.stringify({
    status: 'ok',
    songs: songs.length,
    mixDraw: 'ok',
    replay: 'same',
    playCountDelta: 1,
    history: history.length,
    top: top.length,
    economy: `${plan.effectiveQuality}:${plan.seekMode}`,
    artistInfo: 'ok',
  }),
);
