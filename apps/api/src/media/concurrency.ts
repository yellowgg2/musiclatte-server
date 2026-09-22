type Waiter = {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (reason?: unknown) => void;
  abort: () => void;
};

export function createConcurrencyLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  let active = 0;
  const waiting: Waiter[] = [];

  const release = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      dispatch();
    };
  };
  const dispatch = () => {
    while (active < limit && waiting.length > 0) {
      const waiter = waiting.shift()!;
      waiter.signal.removeEventListener('abort', waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      active += 1;
      waiter.resolve(release());
    }
  };

  return {
    acquire(signal: AbortSignal): Promise<() => void> {
      signal.throwIfAborted();
      if (active < limit) {
        active += 1;
        return Promise.resolve(release());
      }
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          signal,
          resolve,
          reject,
          abort: () => {
            const index = waiting.indexOf(waiter);
            if (index >= 0) waiting.splice(index, 1);
            reject(signal.reason);
          },
        };
        waiting.push(waiter);
        signal.addEventListener('abort', waiter.abort, { once: true });
      });
    },
  };
}
