import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

describe('external watch configuration', () => {
  it('should preserve the existing import identity bytes in one pure helper', async () => {
    const module = await import('../src/imports/identity.js').catch(() => ({}));
    expect(module).toHaveProperty('importIdentityKey');
    if (!('importIdentityKey' in module)) return;
    const signed = Buffer.from('identity-fixture').toString('base64url');
    const sign = (purpose: string, value: string) => {
      expect(purpose).toBe('import-identity');
      expect(value).toBe(JSON.stringify(['instance-1', 'alice']));
      return signed;
    };
    expect(module.importIdentityKey(sign, 'instance-1', 'alice')).toBe(
      Buffer.from('identity-fixture').toString('hex'),
    );
  });

  it('should project only watched libraries without exposing a signing key to the worker', async () => {
    const module = await import('../src/imports/external-watch-config.js').catch(() => ({}));
    expect(module).toHaveProperty('projectExternalWatchOwners');
    if (!('projectExternalWatchOwners' in module)) return;
    const calls: [string, string][] = [];
    const owners = module.projectExternalWatchOwners({
      policy: {
        enabled: true,
        engineManagers: [],
        libraries: [
          {
            id: 'music',
            musicFolderId: '1',
            relativeRoot: 'imports',
            allowedUsers: ['Alice'],
            watchExternalMp3: true,
          },
          {
            id: 'archive',
            musicFolderId: '2',
            relativeRoot: 'archive',
            allowedUsers: ['bob'],
            watchExternalMp3: false,
          },
        ],
      },
      instance: { id: 'instance-1', policyRevision: 4 },
      sign: (purpose: string, value: string) => {
        calls.push([purpose, value]);
        return Buffer.from('x'.repeat(32)).toString('base64url');
      },
    });
    expect(owners).toEqual([
      {
        libraryId: 'music',
        accountDirectory: 'Alice',
        username: 'Alice',
        identityKey: Buffer.from('x'.repeat(32)).toString('hex'),
      },
    ]);
    expect(calls).toEqual([['import-identity', JSON.stringify(['instance-1', 'Alice'])]]);
  });

  it('should fail closed when the current projection differs from worker policy expectations', async () => {
    ctx = await createTestContext();
    const repository = createExternalWatchRepository({ database: ctx.db, clock: () => 10 });
    repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 2,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'alice',
          username: 'alice',
          identityKey: 'a'.repeat(64),
        },
      ],
    });
    expect(
      repository.readOwners({
        instanceId: 'instance-1',
        policyRevision: 2,
        expected: [{ libraryId: 'music', accountDirectory: 'alice', username: 'alice' }],
      }),
    ).toMatchObject({ status: 'ready', owners: [{ identityKey: 'a'.repeat(64) }] });
    repository.ensureRoot({
      libraryId: 'music',
      accountDirectory: 'alice',
      identityKey: 'a'.repeat(64),
    });
    repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 3,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'alice',
          username: 'alice',
          identityKey: 'a'.repeat(64),
        },
      ],
    });
    expect(
      repository.readOwners({
        instanceId: 'instance-1',
        policyRevision: 3,
        expected: [{ libraryId: 'music', accountDirectory: 'alice', username: 'alice' }],
      }),
    ).toMatchObject({ status: 'ready' });
    expect(
      ctx.db.connection.prepare('SELECT count(*) AS count FROM external_watch_roots').get(),
    ).toEqual({ count: 1 });
    for (const input of [
      {
        instanceId: 'stale-instance',
        policyRevision: 2,
        expected: [{ libraryId: 'music', accountDirectory: 'alice', username: 'alice' }],
      },
      {
        instanceId: 'instance-1',
        policyRevision: 2,
        expected: [{ libraryId: 'music', accountDirectory: 'alice', username: 'alice' }],
      },
      {
        instanceId: 'instance-1',
        policyRevision: 3,
        expected: [{ libraryId: 'music', accountDirectory: 'renamed', username: 'alice' }],
      },
    ])
      expect(repository.readOwners(input)).toEqual({ status: 'mismatch', owners: [] });
  });
});
