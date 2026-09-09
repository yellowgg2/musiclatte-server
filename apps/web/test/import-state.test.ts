// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '@musiclatte/contracts';
import { createImportClient } from '../src/imports/client';
import { createImportStore } from '../src/imports/state';
import { parseImportInput } from '../src/imports/input';
import { parseYouTubeSource } from '../../api/src/imports/source-url';
const job: ImportJob = {
  id: 'job',
  libraryId: 'music',
  createdAt: 1,
  cancelRequestedAt: null,
  retryOfJobId: null,
  status: 'running',
  items: [{ id: 'item', sourceId: 'abcdefghijk', stage: 'registering' }],
};
const stores: ReturnType<typeof createImportStore>[] = [];
function makeSUT() {
  let jobs = [structuredClone(job)];
  let error = false;
  let pending: ((response: Response) => void) | undefined;
  let delay = false;
  let reads = 0;
  const signals: AbortSignal[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    reads++;
    signals.push(init!.signal!);
    if (delay) {
      delay = false;
      return new Promise((resolve) => {
        pending = resolve;
      });
    }
    return error
      ? Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 })
      : Response.json({ schemaVersion: 1, jobs, libraries: [{ id: 'music' }], nextCursor: null });
  };
  const store = createImportStore(createImportClient({ fetcher }), 'synthetic', () => {});
  stores.push(store);
  return {
    store,
    signals,
    get reads() {
      return reads;
    },
    setJobs(value: ImportJob[]) {
      jobs = value;
    },
    fail() {
      error = true;
    },
    recover() {
      error = false;
    },
    delay() {
      delay = true;
    },
    resolve() {
      pending?.(
        Response.json({
          schemaVersion: 1,
          jobs: [job],
          libraries: [{ id: 'music' }],
          nextCursor: null,
        }),
      );
    },
  };
}
afterEach(() => {
  stores.splice(0).forEach((s) => s.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('route-scoped import polling', () => {
  /** Registering remains active; completed work no longer causes background requests. */
  it('should poll active items every two seconds and stop after ready', async () => {
    vi.useFakeTimers();
    const c = makeSUT();
    c.store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.reads).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(c.reads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(c.reads).toBe(2);
    c.setJobs([
      {
        ...job,
        status: 'completed',
        items: [{ ...job.items[0]!, stage: 'ready', mediaLinkId: 'media' }],
      },
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.store.getSnapshot().jobs[0]?.items[0]?.stage).toBe('ready');
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.reads).toBe(3);
  });
  /** Blur/hidden/offline pause work, abort in-flight reads and focus refreshes without stale replacement. */
  it('should fence late reads and pause hidden and offline sessions', async () => {
    vi.useFakeTimers();
    const c = makeSUT();
    c.store.start();
    await vi.advanceTimersByTimeAsync(0);
    c.delay();
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event('blur'));
    expect(c.signals.at(-1)?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.reads).toBe(2);
    c.setJobs([
      {
        ...job,
        status: 'completed',
        items: [{ ...job.items[0]!, stage: 'ready', mediaLinkId: 'media' }],
      },
    ]);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    c.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.store.getSnapshot().jobs[0]?.items[0]?.stage).toBe('ready');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.reads).toBe(3);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.reads).toBe(4);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.reads).toBe(4);
  });
  /** Read failures keep existing success data, cap retries and recover explicitly. */
  it('should bound error backoff and preserve the last successful results', async () => {
    vi.useFakeTimers();
    const c = makeSUT();
    c.store.start();
    await vi.advanceTimersByTimeAsync(0);
    c.fail();
    await vi.advanceTimersByTimeAsync(30000);
    expect(c.reads).toBe(4);
    expect(c.store.getSnapshot().jobs).toHaveLength(1);
    expect(c.store.getSnapshot().error).toBe('upstream_unavailable');
    await vi.advanceTimersByTimeAsync(30000);
    expect(c.reads).toBe(4);
    c.recover();
    await c.store.refresh();
    expect(c.store.getSnapshot().error).toBeNull();
    expect(c.reads).toBe(5);
  });
  /** Decoder/input checks preserve the server allowlist without importing API runtime into the bundle. */
  it('should match the producer individual-video URL allowlist', () => {
    const valid = [
      'https://youtu.be/abcdefghijk',
      'https://www.youtube.com/watch?v=abcdefghijk&t=12s',
      'https://youtube.com/shorts/abcdefghijk',
      'https://www.youtube.com/watch?v=s3_uirvnSdI&list=RDVf2PhH7d7j0&index=20',
    ];
    for (const url of valid)
      expect(parseImportInput(url)).toEqual([parseYouTubeSource(url).canonicalUrl]);
    for (const url of [
      'http://youtu.be/abcdefghijk',
      'https://youtu.be:443/abcdefghijk',
      'https://youtube.com/playlist?list=playlist',
      'https://youtu.be/abcdefghijk#fragment',
      'https://youtu.be/abcdefghijk?unknown=x',
      'https://youtube.com/@channel',
    ])
      expect(() => parseImportInput(url)).toThrow();
    expect(parseImportInput(valid.join('\n'))).toHaveLength(valid.length);
  });
});

/** History pagination retains its cursor across active polling and resolves off-page retry parents. */
it('should preserve exhausted history and load the original job for a retry link', async () => {
  const parent = {
    ...job,
    id: 'parent',
    status: 'failed' as const,
    items: [{ ...job.items[0]!, stage: 'failed' as const }],
  };
  const child = { ...job, id: 'child', retryOfJobId: 'parent' };
  const fetcher: typeof fetch = async (input) => {
    const path = String(input);
    if (path.endsWith('/parent')) return Response.json({ schemaVersion: 1, job: parent });
    return Response.json({
      schemaVersion: 1,
      jobs: path.includes('?') ? [{ ...parent, id: 'older' }] : [child],
      libraries: [{ id: 'music' }],
      nextCursor: path.includes('?') ? null : 'page-two',
    });
  };
  const store = createImportStore(createImportClient({ fetcher }), 'synthetic', () => {});
  stores.push(store);
  await store.refresh();
  expect(store.getSnapshot().jobs.some((j) => j.id === 'parent')).toBe(true);
  await store.more();
  expect(store.getSnapshot().nextCursor).toBeNull();
  await store.refresh();
  expect(store.getSnapshot().nextCursor).toBeNull();
  expect(store.getSnapshot().jobs.some((j) => j.id === 'older')).toBe(true);
});
