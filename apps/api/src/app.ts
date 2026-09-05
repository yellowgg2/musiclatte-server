import Fastify from 'fastify';
import { isIP } from 'node:net';
import type { HealthResponse } from '@musiclatte/contracts';

export function readConfig(env: Record<string, string | undefined>) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3000';
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!isIP(host) && host !== 'localhost') throw new Error('Invalid HOST');
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid PORT');
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  return { host, port: Number(rawPort), nodeEnv };
}

export function createApp() {
  const app = Fastify({ logger: false });
  app.get<{ Reply: HealthResponse }>('/health/live', async () => ({ status: 'ok' }));
  return app;
}
