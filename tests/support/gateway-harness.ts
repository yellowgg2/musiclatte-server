import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Real nginx with synthetic upstreams; no production credentials or library data. */
export async function createTestContext(config: string, enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-gateway-'));
  const name = `musiclatte-gateway-${randomUUID()}`;
  const requests: { url: string; method: string; range?: string; body: string }[] = [];
  const state = { unavailable: false };
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      url: req.url!,
      method: req.method!,
      ...(req.headers.range ? { range: req.headers.range } : {}),
      body,
    });
    if (state.unavailable) {
      req.socket.destroy();
      return;
    }
    if (req.url?.startsWith('/rest/stream')) {
      res.writeHead(206, {
        'content-type': 'audio/mpeg',
        'content-range': 'bytes 2-5/8',
        'accept-ranges': 'bytes',
        etag: '"synthetic"',
        'cache-control': 'private',
        'content-length': '4',
      });
      res.end(Buffer.from([2, 3, 4, 5]));
    } else if (req.url?.startsWith('/rest/error')) {
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end('<subsonic-response status="failed"><error code="50"/></subsonic-response>');
    } else if (req.url?.startsWith('/rest/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"subsonic-response":{"status":"ok"}}');
    } else {
      res.writeHead(req.url === '/.well-known/musiclatte-server' ? 200 : 404, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'set-cookie': '__Host-fixture=synthetic; Secure; HttpOnly; Path=/; SameSite=Strict',
      });
      res.end('{"schemaVersion":1}');
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '0.0.0.0', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  const rendered = config
    .replaceAll('gonic:80', `host.docker.internal:${address.port}`)
    .replaceAll('api:3000', `host.docker.internal:${address.port}`)
    .replaceAll('${WEB_UI_ENABLED}', String(enabled));
  writeFileSync(join(root, 'nginx.conf'), rendered);
  mkdirSync(join(root, 'www'));
  writeFileSync(join(root, 'www/index.html'), '<html><div id="root"></div></html>');
  const cleanup = async () => {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      execFileSync('docker', ['network', 'rm', name], { stdio: 'ignore' });
    } finally {
      await new Promise<void>((resolve) => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
      rmSync(root, { recursive: true, force: true });
    }
  };
  try {
    execFileSync('docker', ['network', 'create', name], { stdio: 'pipe' });
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--network',
        name,
        '--name',
        name,
        '--add-host',
        'host.docker.internal:host-gateway',
        '-p',
        '127.0.0.1::8080',
        '-v',
        `${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,
        '-v',
        `${root}/www:/usr/share/nginx/html:ro`,
        'nginx:1.28.0-alpine',
      ],
      { stdio: 'pipe' },
    );
    const port = execFileSync('docker', ['port', name, '8080/tcp'], { encoding: 'utf8' })
      .trim()
      .split(':')
      .at(-1)!;
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        await fetch(`${origin}/health/live`);
        break;
      } catch {
        if (i === 40) throw new Error('gateway fixture failed to start');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return {
      origin,
      requests,
      state,
      cleanup,
      logs: () =>
        execFileSync('docker', ['logs', name], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
