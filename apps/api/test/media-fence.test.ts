import { expect, it } from 'vitest';
import { mkdirSync, realpathSync, symlinkSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';

it('holds a real OS fence through commit acknowledgement and releases it on crash', async () => {
  const { createMediaFence } = await import('../src/metadata/media-fence.js');
  const c = await createTestContext();
  try {
    const root = join(realpathSync(c.root), 'locks');
    mkdirSync(root, { mode: 0o700 });
    const fence = createMediaFence({
      root,
      python: '/usr/bin/python3',
      helperPath: resolve('apps/api/helpers/media_fence.py'),
      timeoutMs: 5000,
    });
    const identity = 'a'.repeat(64);
    const held = await fence.acquire(identity, 'verify');
    await expect(fence.acquire(identity, 'publish')).rejects.toThrow('file_busy');
    process.kill(held.pid, 'SIGSTOP');
    await expect(fence.acquire(identity, 'verify')).rejects.toThrow('file_busy');
    process.kill(held.pid, 'SIGCONT');
    await held.validate();
    held.kill();
    await held.closed;
    expect(() => held.assertHeld()).toThrow('fence_lost');
    const next = await fence.acquire(identity, 'publish');
    await next.release();
    await expect(
      fence.withMediaFence(identity, 'verify', async (current) => {
        await current.validate();
        return 7;
      }),
    ).resolves.toBe(7);
    symlinkSync(join(root, identity + '.lock'), join(root, 'b'.repeat(64) + '.lock'));
    await expect(fence.acquire('b'.repeat(64), 'verify')).rejects.toThrow();
    chmodSync(root, 0o777);
    await expect(fence.acquire(identity, 'verify')).rejects.toThrow();
  } finally {
    c.cleanup();
  }
});
