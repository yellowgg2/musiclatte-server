import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { MetadataPolicy } from '../metadata/policy.js';
import type { ManagementDatabase } from '../storage/database.js';
import type { CredentialVault } from '../security/credential-vault.js';
export interface AutomationOptions {
  curation?: {
    limits: import('../curation/policy.js').CurationLimits;
    fence?: ReturnType<typeof import('../metadata/media-fence.js').createMediaFence>;
  };
  database: ManagementDatabase;
  vault: CredentialVault;
  policy: MetadataPolicy;
  clock: () => number;
  maxTokenAgeMs: number;
}
export function readAutomationConfig(
  env: Record<string, string | undefined>,
): { enabled: false } | { enabled: true; maxTokenAgeMs: number } {
  try {
    const enabled = env.AUTOMATION_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw new Error();
    if (enabled === 'false') return { enabled: false };
    const path = env.AUTOMATION_CONFIG_PATH;
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
      Object.keys(config).length !== 2 ||
      !('schemaVersion' in config) ||
      config.schemaVersion !== 1 ||
      !('maxTokenAgeMs' in config) ||
      typeof config.maxTokenAgeMs !== 'number' ||
      !Number.isSafeInteger(config.maxTokenAgeMs) ||
      config.maxTokenAgeMs < 1
    )
      throw new Error();
    return { enabled: true, maxTokenAgeMs: config.maxTokenAgeMs };
  } catch {
    throw new Error('Invalid automation configuration');
  }
}
