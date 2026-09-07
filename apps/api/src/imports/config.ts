import { loadImportPolicy } from './policy.js';

/** Server-only probe shared by API startup and the future worker entry. */
export function readImportConfig(env: Record<string, string | undefined>) {
  try {
    const enabled = env.IMPORTS_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw new Error();
    if (enabled === 'false')
      return Object.freeze({ enabled: false as const, policy: loadImportPolicy(undefined, false) });
    const username = env.IMPORT_WORKER_USERNAME;
    const password = env.IMPORT_WORKER_PASSWORD;
    if (
      !username ||
      username !== username.trim() ||
      /[\u0000-\u001f\u007f]/.test(username) ||
      !password ||
      /[\u0000\r\n]/.test(password)
    )
      throw new Error();
    return Object.freeze({
      enabled: true as const,
      policy: loadImportPolicy(env.IMPORT_POLICY_PATH, true),
      workerCredentials: Object.freeze({ username, password }),
    });
  } catch {
    throw new Error('invalid_import_config');
  }
}

/** The API never receives the fixed scan account credential. */
export function readApiImportConfig(env: Record<string, string | undefined>) {
  try {
    const enabled = env.IMPORTS_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw new Error();
    return {
      enabled: enabled === 'true',
      policy: loadImportPolicy(env.IMPORT_POLICY_PATH, enabled === 'true'),
    };
  } catch {
    throw new Error('invalid_import_config');
  }
}
