import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readAutomationConfig } from '../src/automation/config.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const policy = {
  schemaVersion: 1,
  maxTokenAgeMs: 86_400_000,
  curation: {
    policyVersion: 'required-v1',
    limits: {
      claimLeaseMs: 60_000,
      maxTargets: 10,
      snapshotMaxAgeMs: 60_000,
      snapshotMaxItems: 1_000,
      snapshotMaxCount: 100,
    },
    inventory: {
      batchSize: 2,
      batchTimeMs: 1_000,
      sweepIntervalMs: 60_000,
      maxQueueItems: 1_000,
    },
  },
  organization: {
    policyVersion: 'id3-managed-v1',
    accounts: [
      { username: 'example-user', accountDirectory: 'example-account' },
      { username: '日本語-user', accountDirectory: 'jp-account' },
    ],
  },
};

function read(value: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-automation-'));
  roots.push(root);
  const path = join(root, 'policy.json');
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  chmodSync(root, 0o700);
  return readAutomationConfig({ AUTOMATION_ENABLED: 'true', AUTOMATION_POLICY_PATH: path });
}

it('loads explicit username to single-segment organization accounts', () => {
  expect(read(policy)).toMatchObject({
    enabled: true,
    organization: policy.organization,
  });
});

it.each([
  '/absolute',
  'nested/account',
  'nested\\account',
  '.',
  '..',
  ' trailing',
  'trailing. ',
  'control\u0000',
])('rejects an unsafe account directory %s', (accountDirectory) => {
  expect(() =>
    read({
      ...policy,
      organization: {
        ...policy.organization,
        accounts: [{ username: 'example-user', accountDirectory }],
      },
    }),
  ).toThrow('Invalid automation configuration');
});

it('rejects duplicate usernames and normalized account directories', () => {
  for (const accounts of [
    [
      { username: 'same', accountDirectory: 'one' },
      { username: 'same', accountDirectory: 'two' },
    ],
    [
      { username: 'one', accountDirectory: 'Café' },
      { username: 'two', accountDirectory: 'Cafe\u0301' },
    ],
  ]) {
    expect(() => read({ ...policy, organization: { ...policy.organization, accounts } })).toThrow(
      'Invalid automation configuration',
    );
  }
});
