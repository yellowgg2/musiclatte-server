import { createServer } from 'node:http';
import { subsonicFixture } from './subsonic-fixtures.js';
export interface SubsonicScenario {
  body?: unknown; status?: number; contentType?: string;
  stall?: 'headers' | 'body'; redirectTo?: string; disconnect?: boolean; empty?: boolean;
}
const reads = new Set(['ping', 'getUser', 'getMusicFolders', 'getIndexes', 'getMusicDirectory', 'search3', 'getArtist', 'getAlbum', 'getRandomSongs']);
/** Loopback-only test server. Captured requests must only contain synthetic credentials. */
export async function createFakeSubsonic(scenario: SubsonicScenario = {}) {
  const requests: URL[] = [];
  let received!: () => void;
  const firstRequest = new Promise<void>(resolve => { received = resolve; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url);
    received();
    const operation = url.pathname.replace(/^\/rest\//, '');
    if (request.method !== 'GET' || !url.pathname.startsWith('/rest/') || !reads.has(operation)) {
      response.writeHead(405); response.end(); return;
    }
    if (scenario.disconnect) { request.socket.destroy(); return; }
    if (scenario.stall === 'headers') return;
    if (scenario.redirectTo) { response.writeHead(302, { Location: scenario.redirectTo }); response.end(); return; }
    response.writeHead(scenario.status ?? 200, { 'Content-Type': scenario.contentType ?? 'application/json' });
    if (scenario.stall === 'body') { response.flushHeaders(); response.write('{'); return; }
    const body = scenario.body === undefined ? subsonicFixture(operation, scenario.empty) : scenario.body;
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture failed to listen');
  return {
    url: `http://127.0.0.1:${address.port}`, requests,
    waitForRequest: () => firstRequest,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
