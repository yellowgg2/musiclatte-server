import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.js';
import { createTestContext as storageContext } from './session-storage-harness.js';
import {
  subsonicFixture,
  subsonicErrorFixture,
} from '../../packages/test-support/src/subsonic-fixtures.js';

export const origin = 'https://music.example.test';
export const password = {
  kind: 'password',
  username: 'fixture-listener',
  password: 'synthetic-password',
};
export const native = {
  kind: 'subsonic-token',
  username: password.username,
  t: createHash('md5')
    .update(password.password + 'fixture-salt')
    .digest('hex'),
  s: 'fixture-salt',
};
export const browserHeaders = {
  origin,
  'x-musiclatte-client': 'web',
  'content-type': 'application/json',
};
export interface AuthOptions {
  sessions: Awaited<ReturnType<typeof storageContext>>['sessions'];
  instances: Awaited<ReturnType<typeof storageContext>>['instances'];
  signingKey: Uint8Array;
  origin: string;
  upstream: string;
  timeoutMs: number;
  secureCookies: boolean;
  allowScan: boolean;
}
export async function createTestContext(overrides: Partial<AuthOptions> = {}) {
  const storage = await storageContext();
  const state = {
    adminRole: false as unknown,
    username: password.username,
    status: 200,
    error: 0,
    randomStatus: 200,
    randomError: 0,
    redirect: '',
    stall: false,
    scanError: 0,
  };
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(url);
    if (state.stall) return;
    if (state.redirect) {
      res.writeHead(302, { location: state.redirect });
      res.end();
      return;
    }
    const operation = url.pathname.slice('/rest/'.length);
    const isRandom = operation === 'getRandomSongs';
    res.writeHead(isRandom ? state.randomStatus : state.status, {
      'content-type': 'application/json',
    });
    const valid =
      url.searchParams.get('t') ===
      createHash('md5')
        .update(password.password + url.searchParams.get('s'))
        .digest('hex');
    const code = !valid
      ? 40
      : state.error ||
        (isRandom ? state.randomError : operation === 'startScan' ? state.scanError : 0);
    const body = code
      ? subsonicErrorFixture(code, 'synthetic-secret-upstream-message')
      : operation === 'getUser'
        ? {
            'subsonic-response': {
              status: 'ok',
              version: '1.15.0',
              user: { username: state.username, adminRole: state.adminRole, folder: [999] },
            },
          }
        : operation === 'startScan'
          ? {
              'subsonic-response': {
                status: 'ok',
                version: '1.15.0',
                scanStatus: { scanning: true, count: 0 },
              },
            }
          : subsonicFixture(operation);
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  const options: AuthOptions = {
    sessions: storage.sessions,
    instances: storage.instances,
    signingKey: new Uint8Array(32).fill(7),
    origin,
    upstream: `http://127.0.0.1:${address.port}`,
    timeoutMs: 300,
    secureCookies: true,
    allowScan: false,
    ...overrides,
  };
  const factory: (options?: AuthOptions) => FastifyInstance = createApp;
  const app = factory(options);
  return {
    app,
    options,
    state,
    requests,
    storage,
    login: (headers: Record<string, string> = browserHeaders, payload: object = password) =>
      app.inject({ method: 'POST', url: '/api/v1/session', headers, payload }),
    async cleanup() {
      await app.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      storage.cleanup();
    },
  };
}
export function cookieOf(response: { headers: Record<string, unknown> }): string {
  return String(response.headers['set-cookie'] ?? '').split(';')[0]!;
}
