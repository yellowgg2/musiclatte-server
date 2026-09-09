import { curationRecord } from '@musiclatte/contracts';
import { createCurationPolicy, type CurationLimits } from '../curation/policy.js';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { MetadataPolicy } from '../metadata/policy.js';
import type { ManagementDatabase } from '../storage/database.js';
import type { CredentialVault } from '../security/credential-vault.js';
export interface AutomationOptions {
  curation?: {
    ready?: () => boolean;
    limits: import('../curation/policy.js').CurationLimits;
    fence?: ReturnType<typeof import('../metadata/media-fence.js').createMediaFence>;
  };
  database: ManagementDatabase;
  vault: CredentialVault;
  policy: MetadataPolicy;
  clock: () => number;
  maxTokenAgeMs: number;
}
export interface CurationRuntimePolicy {
  policyVersion: 'required-v1';
  limits: CurationLimits;
  inventory: {
    batchSize: number;
    batchTimeMs: number;
    sweepIntervalMs: number;
    maxQueueItems: number;
  };
}
export function readAutomationConfig(
  env: Record<string, string | undefined>,
): { enabled: false } | { enabled: true; maxTokenAgeMs: number; curation?: CurationRuntimePolicy } {
  try {
    const enabled = env.AUTOMATION_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw new Error();
    if (enabled === 'false') return { enabled: false };
    if (env.AUTOMATION_POLICY_PATH && env.AUTOMATION_CONFIG_PATH) throw new Error();
    const path = env.AUTOMATION_POLICY_PATH ?? env.AUTOMATION_CONFIG_PATH;
    if (!path || !isAbsolute(path)) throw new Error();
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 65536 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.()
    )
      throw new Error();
    const config: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      Object.keys(config).length !== (env.AUTOMATION_POLICY_PATH ? 3 : 2) ||
      !('schemaVersion' in config) ||
      config.schemaVersion !== 1 ||
      !('maxTokenAgeMs' in config) ||
      typeof config.maxTokenAgeMs !== 'number' ||
      !Number.isSafeInteger(config.maxTokenAgeMs) ||
      config.maxTokenAgeMs < 1
    )
      throw new Error();
    curationRecord(
      config,
      env.AUTOMATION_POLICY_PATH
        ? ['schemaVersion', 'maxTokenAgeMs', 'curation']
        : ['schemaVersion', 'maxTokenAgeMs'],
    );
    if (config.maxTokenAgeMs > 366 * 86400000) throw new Error();
    if (!env.AUTOMATION_POLICY_PATH) return { enabled: true, maxTokenAgeMs: config.maxTokenAgeMs };
    const c = curationRecord((config as Record<string, unknown>).curation, [
      'policyVersion',
      'limits',
      'inventory',
    ]);
    if (c.policyVersion !== 'required-v1') throw new Error();
    const limits = curationRecord(c.limits, [
      'claimLeaseMs',
      'maxTargets',
      'snapshotMaxAgeMs',
      'snapshotMaxItems',
      'snapshotMaxCount',
    ]) as unknown as CurationLimits;
    createCurationPolicy(limits);
    const inventory = curationRecord(c.inventory, [
      'batchSize',
      'batchTimeMs',
      'sweepIntervalMs',
      'maxQueueItems',
    ]);
    const max = {
      batchSize: 100,
      batchTimeMs: 5000,
      sweepIntervalMs: 86400000,
      maxQueueItems: 1000000,
    };
    for (const [key, value] of Object.entries(inventory))
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > max[key as keyof typeof max]
      )
        throw new Error();
    if (Number(inventory.sweepIntervalMs) < Number(inventory.batchTimeMs)) throw new Error();
    return {
      enabled: true,
      maxTokenAgeMs: config.maxTokenAgeMs,
      curation: {
        policyVersion: 'required-v1',
        limits,
        inventory: inventory as CurationRuntimePolicy['inventory'],
      },
    };
  } catch {
    throw new Error('Invalid automation configuration');
  }
}
