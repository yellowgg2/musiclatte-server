import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { readAutomationConfig } from '../src/automation/config.js';
export const policyFixture = {
  schemaVersion: 1,
  maxTokenAgeMs: 86400000,
  curation: {
    policyVersion: 'required-v1',
    limits: {
      claimLeaseMs: 60000,
      maxTargets: 10,
      snapshotMaxAgeMs: 60000,
      snapshotMaxItems: 1000,
      snapshotMaxCount: 100,
    },
    inventory: { batchSize: 2, batchTimeMs: 1000, sweepIntervalMs: 60000, maxQueueItems: 1000 },
  },
};
it('validates a private full automation policy and refuses unknown or unbounded settings', async () => {
  const c = await createTestContext();
  try {
    const file = join(c.root, 'automation-policy.json');
    writeFileSync(file, JSON.stringify(policyFixture), { mode: 0o600 });
    const env = { AUTOMATION_ENABLED: 'true', AUTOMATION_POLICY_PATH: file };
    expect(readAutomationConfig(env)).toMatchObject({
      enabled: true,
      curation: policyFixture.curation,
    });
    writeFileSync(
      file,
      JSON.stringify({
        ...policyFixture,
        curation: {
          ...policyFixture.curation,
          inventory: { ...policyFixture.curation.inventory, batchTimeMs: 600000 },
        },
      }),
    );
    expect(() => readAutomationConfig(env)).toThrow();
    writeFileSync(file, JSON.stringify({ ...policyFixture, secret: 'forbidden' }));
    expect(() => readAutomationConfig(env)).toThrow();
  } finally {
    c.cleanup();
  }
});
it('gives inventory a bounded turn after recovery, file and reflection and propagates stop', async () => {
  const { createMetadataScheduler } = await import('../src/metadata-worker-runtime.js');
  const calls: string[] = [];
  const tasks = {
    recover: async () => {
      calls.push('recover');
      return false;
    },
    file: async () => {
      calls.push('file');
      return true;
    },
    reflect: async () => {
      calls.push('reflect');
      return false;
    },
    inventory: async () => {
      calls.push('inventory');
      return true;
    },
  };
  const scheduler = createMetadataScheduler(tasks);
  await scheduler.cycle(new AbortController().signal);
  expect(calls).toEqual(['recover', 'file', 'reflect', 'inventory']);
});

it('resumes inventory checkpoints, re-verifies stale restores immediately and stops in-flight discovery', async () => {
  const { createCurationMutationContext } =
    await import('../../../tests/support/curation-mutation-harness.js');
  const c = await createCurationMutationContext();
  try {
    const { createCurationScheduler } = await import('../src/curation/runtime.js');
    let roots = 0;
    const options = {
      database: c.storage.db,
      clock: c.clock,
      signingKey: c.options.signingKey,
      policy: policyFixture.curation as import('../src/automation/config.js').CurationRuntimePolicy,
      libraries: c.metadata.policy.libraries,
      source: {
        inventoryIndexes: async () => {
          roots++;
          return { roots: [{ id: 'track-1', isDir: false }], lastModified: 1 };
        },
        registrationDirectory: async () => ({ id: 'unused', name: 'unused', child: [] }),
        recentSong: async (id: string) => ({
          song: { id, isDir: false, title: 'Fixture' },
          path: 'imports/source.mp3',
        }),
      },
      helper: c.helper,
      runtime: c.metadata.runtime,
      fence: c.fence,
    };
    const first = createCurationScheduler(options);
    await first.cycle(new AbortController().signal);
    const second = createCurationScheduler(options);
    await second.cycle(new AbortController().signal);
    expect(roots).toBe(1);
    c.storage.db.connection.prepare("UPDATE curation_inventory_runs SET status='stale'").run();
    await second.cycle(new AbortController().signal);
    expect(roots).toBe(2);
    const abort = new AbortController();
    c.storage.db.connection.prepare("UPDATE curation_inventory_runs SET status='stale'").run();
    const blocked = createCurationScheduler({
      ...options,
      source: {
        ...options.source,
        inventoryIndexes: async (_id, request) =>
          new Promise((_resolve, reject) => {
            request?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
            abort.abort();
          }),
      },
    });
    await blocked.cycle(abort.signal);
    expect(
      c.storage.db.connection.prepare('SELECT status FROM curation_inventory_runs').get()!.status,
    ).toBe('discovering');
  } finally {
    await c.cleanup();
  }
});
it('accepts existing long metadata jobs while bounding the separate fence protocol timeout', async () => {
  const { realpathSync } = await import('node:fs');
  const { configuredMediaFence } = await import('../src/curation/runtime.js');
  const c = await createTestContext();
  try {
    const root = join(realpathSync(c.root), 'fence');
    mkdirSync(root, { mode: 0o700 });
    expect(() =>
      configuredMediaFence(
        { MEDIA_FENCE_ROOT: root },
        {
          python: '/usr/bin/python3',
          helperPath: '/app/helpers/metadata.py',
          musicRoot: '/music',
          timeoutMs: 120000,
        },
      ),
    ).not.toThrow();
  } finally {
    c.cleanup();
  }
});
