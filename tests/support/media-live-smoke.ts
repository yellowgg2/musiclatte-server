/** Read-only live gonic verification; outputs transport facts only, never IDs, metadata or auth. */
import { createTestContext } from './auth-harness.js';
import { cookieOf } from './auth-harness.js';

const upstream = process.env.LIVE_GONIC_UPSTREAM;
const username = process.env.LIVE_GONIC_USERNAME;
const password = process.env.LIVE_GONIC_PASSWORD;
if (!upstream || !username || !password) throw new Error('Missing live media smoke configuration');

const context = await createTestContext({
  upstream,
  origin: 'http://127.0.0.1:43109',
  secureCookies: false,
  timeoutMs: 5_000,
});

function selectedHeaders(headers: Record<string, string | number | string[] | undefined>) {
  return Object.fromEntries(
    [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'cache-control',
      'expires',
    ].flatMap((name) => {
      const value = headers[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

try {
  const login = await context.login(
    {
      origin: 'http://127.0.0.1:43109',
      'x-musiclatte-client': 'web',
      'content-type': 'application/json',
    },
    { kind: 'password', username, password },
  );
  if (login.statusCode !== 201) throw new Error(`Live login failed: ${login.statusCode}`);
  const headers = { cookie: cookieOf(login) };
  const random = await context.app.inject({
    url: '/api/v1/music/random?size=100',
    headers,
  });
  if (random.statusCode !== 200) throw new Error(`Live random failed: ${random.statusCode}`);
  const songs = random.json().songs as {
    id: string;
    suffix?: string;
    contentType?: string;
    coverArt?: string;
  }[];
  const song = songs.find((entry) => entry.suffix?.toLowerCase() === 'mp3') ?? songs[0];
  const alternate = songs.find(
    (entry) => entry.suffix?.toLowerCase() !== song?.suffix?.toLowerCase(),
  );
  const coverSong = songs.find((entry) => entry.coverArt);
  if (!song) throw new Error('No readable live song');

  async function streamEvidence(entry: (typeof songs)[number]) {
    const streamPath = `/api/v1/media/songs/${encodeURIComponent(entry.id)}/stream`;
    const head = await context.app.inject({ method: 'HEAD', url: streamPath, headers });
    const range = await context.app.inject({
      url: streamPath,
      headers: { ...headers, range: 'bytes=0-1023' },
    });
    return {
      format: { suffix: entry.suffix ?? null, contentType: entry.contentType ?? null },
      head: {
        status: head.statusCode,
        bytes: head.rawPayload.length,
        headers: selectedHeaders(head.headers),
      },
      range: {
        status: range.statusCode,
        bytes: range.rawPayload.length,
        headers: selectedHeaders(range.headers),
      },
    };
  }
  const result: Record<string, unknown> = {
    streams: await Promise.all([song, ...(alternate ? [alternate] : [])].map(streamEvidence)),
  };
  if (coverSong?.coverArt) {
    const coverPath = `/api/v1/media/cover/${encodeURIComponent(coverSong.coverArt)}`;
    const cover = await context.app.inject({ method: 'HEAD', url: coverPath, headers });
    const lastModified = cover.headers['last-modified'];
    const conditional =
      typeof lastModified === 'string'
        ? await context.app.inject({
            url: coverPath,
            headers: { ...headers, 'if-modified-since': lastModified },
          })
        : undefined;
    result.cover = {
      status: cover.statusCode,
      bytes: cover.rawPayload.length,
      headers: selectedHeaders(cover.headers),
      conditionalStatus: conditional?.statusCode ?? null,
    };
  }
  console.info(JSON.stringify(result));
} finally {
  await context.cleanup();
}
