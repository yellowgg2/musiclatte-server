import { describe, expect, it } from 'vitest';
import { createConcurrencyLimit } from '../src/media/concurrency.js';

describe('media concurrency limit', () => {
  it('should remove an aborted waiter without consuming the next permit', async () => {
    const limit = createConcurrencyLimit(1);
    const first = await limit.acquire(new AbortController().signal);
    const cancelled = new AbortController();
    const waiting = limit.acquire(cancelled.signal).catch((error: unknown) => error);
    cancelled.abort(new Error('cancelled'));

    await expect(waiting).resolves.toEqual(new Error('cancelled'));
    first();
    const next = await limit.acquire(new AbortController().signal);
    next();
  });

  it('should release a permit only once', async () => {
    const limit = createConcurrencyLimit(1);
    const first = await limit.acquire(new AbortController().signal);
    first();
    first();
    const second = await limit.acquire(new AbortController().signal);
    second();
  });
});
