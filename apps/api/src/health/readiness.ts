import type { FastifyInstance } from 'fastify';

/** Connectivity only: no account credentials, capability inference or scan mutation. */
export function registerReadiness(
  app: FastifyInstance,
  upstream: string,
  timeoutMs: number,
  checkStorage: () => void,
): void {
  app.get('/health/ready', async (_request, reply) => {
    try {
      checkStorage();
      const response = await fetch(new URL('/', upstream), {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      if (response.status < 200 || response.status >= 400) throw new Error();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
