import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseMetadataPolicy } from './policy.js';

/** Opt-in metadata is independent of imports, yt-dlp and the administrator's engine role. */
export function readMetadataConfig(env: Record<string, string | undefined>) {
  try {
    const enabled = env.METADATA_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw new Error();
    if (enabled === 'false') return Object.freeze({ enabled: false as const });
    const required = (name: string) => {
      const value = env[name];
      if (!value || !isAbsolute(value) || value.includes('\0')) throw new Error();
      return value;
    };
    const policyPath = required('METADATA_POLICY_PATH');
    const musicRoot = required('METADATA_MUSIC_ROOT');
    const python = required('METADATA_PYTHON');
    const helperPath = required('METADATA_HELPER_PATH');
    const policyStat = lstatSync(policyPath);
    if (
      !policyStat.isFile() ||
      policyStat.isSymbolicLink() ||
      policyStat.size > 1024 * 1024 ||
      !lstatSync(musicRoot).isDirectory() ||
      realpathSync(musicRoot) !== musicRoot ||
      musicRoot === '/' ||
      !statSync(python).isFile() ||
      !lstatSync(helperPath).isFile() ||
      lstatSync(helperPath).isSymbolicLink()
    )
      throw new Error();
    const policy = parseMetadataPolicy(JSON.parse(readFileSync(policyPath, 'utf8')));
    if (!policy.enabled) throw new Error();
    return Object.freeze({ enabled: true as const, policy, musicRoot, python, helperPath });
  } catch {
    throw new Error('invalid_metadata_config');
  }
}
