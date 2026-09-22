import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchInventory } from '../src/imports/external-watch-inventory.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';

it('keeps valid reads available and invalid cleanup fail-closed across three shared DB connections', async () => {
  const c = await createTestContext();
  try {
    const valid = c.sessions.create(proof);
    const invalid = c.sessions.create(proof);
    const invalidHash = createHash('sha256').update(invalid.token).digest('hex');
    c.db.connection
      .prepare("UPDATE sessions SET encrypted_proof='invalid-envelope' WHERE id_hash=?")
      .run(invalidHash);
    const validReader = c.open();
    const invalidReader = c.open();
    const validSessions = c.sessionsFor(validReader);
    const invalidSessions = c.sessionsFor(invalidReader);
    c.db.connection.exec('BEGIN IMMEDIATE');
    try {
      expect(validSessions.find(valid.token)).toMatchObject({
        username: proof.username,
      });
      expect(invalidSessions.find(invalid.token)).toBeNull();
      expect(
        invalidReader.connection
          .prepare('SELECT encrypted_proof FROM sessions WHERE id_hash=?')
          .get(invalidHash)?.encrypted_proof,
      ).toBe('invalid-envelope');
    } finally {
      c.db.connection.exec('ROLLBACK');
    }
    expect(invalidSessions.find(invalid.token)).toBeNull();
    expect(
      invalidReader.connection
        .prepare('SELECT encrypted_proof FROM sessions WHERE id_hash=?')
        .get(invalidHash)?.encrypted_proof,
    ).toBeNull();
  } finally {
    c.cleanup();
  }
});

it('keeps an unchanged external scan O(delta) while curation observes its cooldown', async () => {
  const c = await createTestContext();
  try {
    let now = 1000;
    const musicRoot = join(c.root, 'music');
    const accountRoot = join(musicRoot, 'jojo-music', 'fixture-account');
    mkdirSync(accountRoot, { recursive: true });
    for (let index = 0; index < 20; index += 1)
      writeFileSync(join(accountRoot, `fixture-${index}.mp3`), 'synthetic');
    const repository = createExternalWatchRepository({ database: c.db, clock: () => now });
    repository.syncOwners({
      instanceId: 'fixture-instance',
      policyRevision: 1,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'fixture-account',
          username: 'fixture-user',
          identityKey: 'a'.repeat(64),
        },
      ],
    });
    const inventory = createExternalWatchInventory({
      database: c.db,
      musicRoot,
      clock: () => now,
    });
    const target = {
      libraryId: 'music',
      relativeRoot: 'jojo-music',
      accountDirectory: 'fixture-account',
      identityKey: 'a'.repeat(64),
    };
    const finish = () => {
      let result = inventory.reconcile(target);
      while (result.status === 'progress') result = inventory.reconcile(target);
      expect(result.status).toBe('complete');
    };
    finish();
    const before = Number(c.db.connection.prepare('SELECT total_changes() AS count').get()?.count);
    now = 2000;
    finish();
    const externalDelta =
      Number(c.db.connection.prepare('SELECT total_changes() AS count').get()?.count) - before;
    expect(externalDelta).toBeLessThanOrEqual(3);

    const { createCurationMutationContext } =
      await import('../../../tests/support/curation-mutation-harness.js');
    const curation = await createCurationMutationContext();
    try {
      const { createCurationScheduler } = await import('../src/curation/runtime.js');
      let inventoryCalls = 0;
      const scheduler = createCurationScheduler({
        database: curation.storage.db,
        clock: curation.clock,
        signingKey: curation.options.signingKey,
        policy: {
          policyVersion: 'required-v1',
          limits: {
            claimLeaseMs: 1000,
            maxTargets: 10,
            snapshotMaxAgeMs: 1000,
            snapshotMaxItems: 100,
            snapshotMaxCount: 10,
          },
          inventory: {
            batchSize: 1,
            itemTimeoutMs: 1000,
            batchTimeMs: 1000,
            batchCooldownMs: 60_000,
            retryIntervalMs: 1000,
            maxRetryAttempts: 1,
            sweepIntervalMs: 60_000,
            maxQueueItems: 100,
          },
        },
        libraries: curation.metadata.policy.libraries,
        source: {
          inventoryIndexes: async () => {
            inventoryCalls++;
            return { roots: [] };
          },
          registrationDirectory: async () => ({ id: 'unused', child: [] }),
          recentSong: async (id: string) => ({
            song: { id, isDir: false, title: 'Synthetic' },
            path: 'imports/source.mp3',
          }),
        },
        helper: curation.helper,
        runtime: curation.metadata.runtime,
        fence: curation.fence,
      });
      await scheduler.cycle(new AbortController().signal);
      await scheduler.cycle(new AbortController().signal);
      expect(inventoryCalls).toBe(1);
    } finally {
      await curation.cleanup();
    }
  } finally {
    c.cleanup();
  }
});
