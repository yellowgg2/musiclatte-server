import { afterEach, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
let context: Awaited<ReturnType<typeof createTestContext>>;
afterEach(() => context?.cleanup());
/** Fresh installations keep automatic scans off with a six-hour interval. */
it('persists a disabled six-hour schedule by default', async () => {
  context = await createTestContext();
  const table = context.db.connection
    .prepare("SELECT name FROM sqlite_master WHERE name='scan_schedule'")
    .get();
  expect(table).toBeDefined();
  expect(
    context.db.connection.prepare('SELECT enabled,interval_minutes FROM scan_schedule').get(),
  ).toEqual({ enabled: 0, interval_minutes: 360 });
});

import { createScanScheduler, type ScanOptions } from '../src/scan/scheduler.js';
import { createCredentialVault } from '../src/security/credential-vault.js';
async function makeScheduler() {
  context = await createTestContext();
  let now = 1000;
  let admin = true;
  let scanning = false;
  let calls = 0;
  const options: ScanOptions = {
    database: context.db,
    vault: createCredentialVault(new Uint8Array(32).fill(7)),
    clock: () => now,
    policyRevision: () => 1,
    allowed: () => true,
    client: () => ({
      currentUser: async () => ({ username: 'manager', adminRole: admin }),
      getScanStatus: async () => ({ scanning, count: 0 }),
      startScan: async () => {
        calls++;
      },
    }),
  };
  return {
    options,
    scheduler: createScanScheduler(options),
    advance: (minutes: number) => {
      now += minutes * 60000;
    },
    deny: () => {
      admin = false;
    },
    scanning: () => {
      scanning = true;
    },
    calls: () => calls,
    proof: { username: 'manager', t: 'synthetic-secret-token', s: 'synthetic-salt' },
  };
}
/** Timers survive repository reopening and claims coalesce concurrent API replicas. */
it('runs at six hours and claims one scan across competing schedulers', async () => {
  const s = await makeScheduler();
  s.scheduler.update({ enabled: true, intervalMinutes: 360 }, s.proof);
  expect(
    JSON.stringify(context.db.connection.prepare('SELECT * FROM scan_schedule').get()),
  ).not.toContain(s.proof.t);
  await s.scheduler.tick();
  expect(s.calls()).toBe(0);
  s.advance(360);
  const second = createScanScheduler({ ...s.options, database: context.open() });
  await Promise.all([s.scheduler.tick(), second.tick()]);
  expect(s.calls()).toBe(1);
  expect(second.read().intervalMinutes).toBe(360);
  await second.tick();
  expect(s.calls()).toBe(1);
  await second.close();
  await s.scheduler.close();
});
/** Disable cancels future scheduling; upstream permission loss disables stored authority. */
it('honors disable and revokes automatic scans when admin permission is removed', async () => {
  const s = await makeScheduler();
  s.scheduler.update({ enabled: true, intervalMinutes: 15 }, s.proof);
  s.scheduler.update({ enabled: false, intervalMinutes: 360 }, s.proof);
  s.advance(500);
  await s.scheduler.tick();
  expect(s.calls()).toBe(0);
  s.scheduler.update({ enabled: true, intervalMinutes: 15 }, s.proof);
  s.deny();
  s.advance(15);
  await s.scheduler.tick();
  expect(s.calls()).toBe(0);
  expect(s.scheduler.read()).toMatchObject({
    enabled: false,
    lastError: 'forbidden',
    nextRunAt: null,
  });
});
/** Existing gonic scans are not restarted and invalid intervals cannot be persisted. */
it('skips an active scan and validates interval bounds', async () => {
  const s = await makeScheduler();
  for (const n of [0, 14, 10081, 1.5])
    expect(() => s.scheduler.update({ enabled: true, intervalMinutes: n }, s.proof)).toThrow();
  s.scheduler.update({ enabled: true, intervalMinutes: 15 }, s.proof);
  s.scanning();
  s.advance(15);
  await s.scheduler.tick();
  expect(s.calls()).toBe(0);
});

/** Failed upstream requests keep the interval and do not create a retry storm. */
it('retries upstream failures only at the next scheduled interval', async () => {
  const s = await makeScheduler();
  let attempts = 0;
  const scheduler = createScanScheduler({
    ...s.options,
    client: (proof) => ({
      ...s.options.client(proof),
      startScan: async () => {
        attempts++;
        throw new Error('offline');
      },
    }),
  });
  scheduler.update({ enabled: true, intervalMinutes: 360 }, s.proof);
  s.advance(360);
  await scheduler.tick();
  expect(scheduler.read()).toMatchObject({ enabled: true, lastError: 'upstream_unavailable' });
  await scheduler.tick();
  expect(attempts).toBe(1);
  s.advance(360);
  await scheduler.tick();
  expect(attempts).toBe(2);
});
