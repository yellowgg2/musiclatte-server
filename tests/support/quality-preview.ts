/** Normal product UI preview. Optional private config selects an isolated real gonic upstream. */
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from '../../apps/api/src/app.js';
import { createTestContext } from './auth-harness.js';
const port = Number(process.env.PORT),
  webPort = Number(process.env.WEB_PORT);
if (![port, webPort].every((p) => Number.isInteger(p) && p > 1024 && p < 65536))
  throw new Error('Explicit preview ports required');
let upstream: string | undefined;
if (process.env.MUSICLATTE_P7_PRIVATE_CONFIG) {
  const path = process.env.MUSICLATTE_P7_PRIVATE_CONFIG;
  if ((statSync(path).mode & 0o777) !== 0o600)
    throw new Error('Private0600 configuration required');
  upstream = JSON.parse(readFileSync(path, 'utf8')).upstream;
}
let mode = 'normal';
const proxy = createServer(async (req, res) => {
  if (!upstream) {
    res.writeHead(503);
    res.end();
    return;
  }
  const path = new URL(req.url ?? '/', 'http://fixture');
  if (mode === 'error' && path.pathname.includes('/stream')) {
    res.writeHead(503);
    res.end();
    return;
  }
  const destination = new URL(upstream);
  destination.pathname = path.pathname;
  destination.search = path.search;
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const response = await fetch(destination, {
      method: req.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(
          ([name, value]) =>
            ['range', 'if-range', 'if-none-match', 'if-modified-since'].includes(name) &&
            typeof value === 'string',
        ),
      ) as Record<string, string>,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (path.pathname.includes('/stream'))
      console.info(
        JSON.stringify({
          status: response.status,
          format: path.searchParams.get('format') ?? 'server',
          offset: Number(path.searchParams.get('timeOffset') ?? 0),
          range: req.headers.range !== undefined,
        }),
      );
    if (mode === 'unknown' && path.pathname.includes('getSong')) {
      const body = await response.json();
      delete body['subsonic-response']?.song?.duration;
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(
      response.status,
      Object.fromEntries(
        [...response.headers].filter(
          ([name]) => !['transfer-encoding', 'connection', 'content-encoding'].includes(name),
        ),
      ),
    );
    if (response.body && req.method !== 'HEAD') Readable.from(response.body).pipe(res);
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  }
});
if (upstream) await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
const c = await createTestContext();
c.storage.setNow(Date.now());
c.state.accountIdentityFromProof = true;
c.state.songIdFromRequest = true;
c.state.songBitRateOverride = 256;
const options = {
  ...c.options,
  origin: `http://127.0.0.1:${webPort}`,
  secureCookies: false,
  streamQuality: true,
  sessions: c.storage.sessionsFor(c.storage.db, 3600000),
  ...(upstream && address && typeof address !== 'string'
    ? { upstream: `http://127.0.0.1:${address.port}` }
    : {}),
};
const app = createApp(options);
const timer = setInterval(() => {
  c.storage.setNow(Date.now());
  try {
    mode = process.env.PREVIEW_CONTROL
      ? readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim()
      : 'normal';
  } catch {
    mode = 'normal';
  }
  c.state.songUnknownDuration = mode === 'unknown';
  c.state.mediaStatus = mode === 'error' ? 503 : 200;
}, 100);
await app.listen({ host: '127.0.0.1', port });
console.info('Quality preview ready');
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await app.close();
  await c.cleanup();
  if (upstream) {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
