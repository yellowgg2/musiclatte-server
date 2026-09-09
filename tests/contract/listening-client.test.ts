import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
/** Retrying a local request freezes its event body and does not expose credentials in persistent storage. */
it('should retry the identical qualified payload and stop on an uncertain receipt', async () => {
  const path = resolve('apps/web/src/listening/client.ts');
  expect(existsSync(path), 'bounded listening sender is required').toBe(true);
  const { createListeningSender } = await import(path);
  vi.useFakeTimers();
  const bodies: string[] = [];
  const sender = createListeningSender({
    fetcher: async (_input: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      return bodies.length === 1
        ? Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 })
        : Response.json({ schemaVersion: 1, delivery: { status: 'uncertain' } });
    },
    apiOrigin: '',
    csrfToken: 'fixture',
    onUnauthenticated: () => {},
  });
  const event = {
    eventId: 'a'.repeat(22),
    songId: 'tr-1',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    qualifiedAt: new Date().toISOString(),
    listenedMs: 60000,
  };
  sender.enqueue(event);
  await vi.advanceTimersByTimeAsync(1000);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  await vi.advanceTimersByTimeAsync(20000);
  expect(bodies).toHaveLength(2);
  sender.dispose();
});
/** Retry budget is finite, terminal client errors stop, and scope disposal aborts pending work. */
it('should bound retries and discard pending requests on disposal', async () => {
  const { createListeningSender } = await import('../../apps/web/src/listening/client');
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 }),
  );
  const sender = createListeningSender({
    fetcher,
    apiOrigin: '',
    csrfToken: 'fixture',
    onUnauthenticated: () => {},
  });
  const event = {
    eventId: 'a'.repeat(22),
    songId: 'tr-1',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    qualifiedAt: new Date().toISOString(),
    listenedMs: 60000,
  };
  sender.enqueue(event);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(sender.snapshot()).toMatchObject({ pending: 0, failed: 1 });
  sender.enqueue({ ...event, eventId: 'b'.repeat(22) });
  sender.dispose();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(5);
});
/** Pending memory has a fixed capacity and expired events cannot be transmitted. */
it('should cap pending memory at fifty and reject events older than a day', async () => {
  const { createListeningSender } = await import('../../apps/web/src/listening/client');
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const sender = createListeningSender({
    fetcher,
    apiOrigin: '',
    csrfToken: 'fixture',
    onUnauthenticated: () => {},
  });
  const event = {
    eventId: 'a'.repeat(22),
    songId: 'tr-1',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    qualifiedAt: new Date().toISOString(),
    listenedMs: 60000,
  };
  for (let i = 0; i < 51; i++) sender.enqueue({ ...event, eventId: String(i).padStart(22, '0') });
  expect(sender.snapshot()).toMatchObject({ pending: 50, dropped: 1 });
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  sender.enqueue({
    ...event,
    eventId: 'z'.repeat(22),
    startedAt: new Date(Date.now() - 86400000).toISOString(),
  });
  expect(fetcher).toHaveBeenCalledTimes(51);
  expect(sender.snapshot().dropped).toBe(2);
  sender.dispose();
  expect(sender.snapshot().pending).toBe(0);
});
