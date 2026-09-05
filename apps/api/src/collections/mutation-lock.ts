/** Serialize work for one account/resource key without retaining settled queue entries. */
export function createMutationLock() {
  const tails = new Map<string, Promise<void>>();
  return {
    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(key, tail);
      await previous;
      try {
        return await work();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}
