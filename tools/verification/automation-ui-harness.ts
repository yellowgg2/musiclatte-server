/** Source-only synthetic HTTP fixture around the normal production Router. */
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccessToken } from '../../packages/contracts/src/index.js';
export async function startAutomationUIHarness({
  port,
  scenario = 'tokens',
  controlFile,
}: {
  port: number;
  scenario?: string;
  controlFile?: string;
}): Promise<ViteDevServer> {
  if (scenario !== 'tokens' || (controlFile && !isAbsolute(controlFile)))
    throw new Error('invalid_harness_config');
  const tokens = new Map<string, AccessToken[]>();
  const secrets = new Map<string, AccessToken>();
  let signedIn = true;
  let serial = 0;
  const mode = () => (controlFile ? readFileSync(controlFile, 'utf8').trim() : 'normal');
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
  const fail = (res: ServerResponse, code: string, status: number) =>
    json(res, { schemaVersion: 1, error: { code } }, status);
  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw new Error('large_body');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }
  async function middleware(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';
    const state = mode();
    const username = state === 'other-profile' ? 'Other listener' : 'Studio listener';
    const csrf = 'synthetic-csrf-' + username;
    if (path === '/api/v1/session') {
      if (method === 'DELETE') {
        signedIn = false;
        res.statusCode = 204;
        res.end();
        return;
      }
      if (method === 'POST') {
        await body(req);
        signedIn = true;
      }
      if (!signedIn || state === 'expired-session') return fail(res, 'unauthenticated', 401);
      return json(
        res,
        {
          schemaVersion: 1,
          authScheme: 'cookie',
          username,
          csrfToken: csrf,
          expiresAt: Date.now() + 3600000,
        },
        method === 'POST' ? 201 : 200,
      );
    }
    if (!signedIn || state === 'expired-session') return fail(res, 'unauthenticated', 401);
    if (path === '/api/v1/capabilities')
      return json(res, {
        schemaVersion: 1,
        instanceId: 'automation-ui-fixture',
        revision: state,
        features: {
          'music.browse': { supported: false, permission: 'denied', availability: 'available' },
          'automation.tokens': {
            supported: true,
            permission: state === 'denied' ? 'denied' : 'allowed',
            availability: state === 'unavailable' ? 'temporarily_unavailable' : 'available',
          },
        },
      });
    if (path === '/api/v1/metadata-policy') {
      const raw = req.headers.authorization?.replace(/^Bearer /, '');
      const token = raw ? secrets.get(raw) : undefined;
      return token && token.revokedAt === null && token.expiresAt > Date.now()
        ? json(res, { schemaVersion: 1, policy: { policyVersion: 'required-v1' } })
        : fail(res, 'unauthenticated', 401);
    }
    if (state === 'denied') return fail(res, 'forbidden', 403);
    if (state === 'unavailable') return fail(res, 'upstream_unavailable', 503);
    if (method !== 'GET' && req.headers['x-csrf-token'] !== csrf)
      return fail(res, 'csrf_rejected', 403);
    if (path === '/api/v1/access-tokens/options')
      return json(res, {
        schemaVersion: 1,
        now: Date.now(),
        maxTokenAgeMs: 30 * 86400000,
        libraryIds: ['music', 'archive'],
        scopes: ['metadata:read', 'metadata:write', 'lyrics:write', 'curation:write'],
      });
    const owned = tokens.get(username) ?? [];
    tokens.set(username, owned);
    if (path === '/api/v1/access-tokens' && method === 'GET') {
      if (state === 'list-error') return fail(res, 'upstream_unavailable', 503);
      return json(res, {
        schemaVersion: 1,
        accessTokens: owned,
        total: owned.length,
        nextCursor: null,
      });
    }
    if (path === '/api/v1/access-tokens' && method === 'POST') {
      const input = await body(req);
      const token: AccessToken = {
        id: randomUUID(),
        name: input.name,
        scopes: input.scopes,
        libraryIds: input.libraryIds,
        createdAt: Date.now(),
        expiresAt: input.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      };
      owned.unshift(token);
      serial++;
      const secret = 'mlpat_' + ('REDACTED_SYNTHETIC_' + serial).padEnd(43, 'X');
      secrets.set(secret, token);
      if (state === 'lost-create') {
        res.destroy();
        return;
      }
      if (state === 'late-create') await delay(2000);
      return json(res, { schemaVersion: 1, token: secret, accessToken: token }, 201);
    }
    if (path.startsWith('/api/v1/access-tokens/') && method === 'DELETE') {
      const token = owned.find((token) => token.id === path.split('/').at(-1));
      if (!token) return fail(res, 'not_found', 404);
      token.revokedAt ??= Date.now();
      res.statusCode = 204;
      res.end();
      return;
    }
    fail(res, 'not_found', 404);
  }
  const cacheDir = mkdtempSync(join(tmpdir(), 'musiclatte-automation-ui-'));
  const server = await createServer({
    root: resolve('apps/web'),
    configFile: false,
    cacheDir,
    server: { host: '127.0.0.1', port, strictPort: port !== 0 },
    plugins: [
      {
        name: 'automation-source-only-fixture',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/api/')) {
              next();
              return;
            }
            void middleware(req, res).catch(() => fail(res, 'internal_error', 500));
          });
        },
      },
    ],
  });
  const close = server.close.bind(server);
  server.close = async () => {
    try {
      await close();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  };
  await server.listen();
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (key: string) => args[args.indexOf(key) + 1];
  const port = Number(option('--port'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('unused_port_required');
  const server = await startAutomationUIHarness({
    port,
    scenario: option('--scenario') ?? 'tokens',
    ...(args.includes('--control-file') ? { controlFile: option('--control-file')! } : {}),
  });
  process.stdout.write(`Automation UI fixture: http://127.0.0.1:${port}/settings\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void server.close().then(() => process.exit(0)));
}
