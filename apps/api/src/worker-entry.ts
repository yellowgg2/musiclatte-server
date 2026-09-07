import { readFileSync } from 'node:fs';
import { readWorkerConfig, runWorker, workerHealth } from './worker-runtime.js';

const controller = new AbortController();
const stop = () => controller.abort();
try {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && !['--check-config', '--healthcheck'].includes(args[0]!))
  )
    throw new Error();
  if (args[0] === '--healthcheck') {
    process.exitCode = workerHealth(process.env) ? 0 : 1;
  } else {
    // The image owns this non-secret manifest; operators do not choose runtime binaries via HTTP.
    const env = { ...process.env };
    if (env.IMPORTS_ENABLED === 'true' && env.IMPORT_SEED_MANIFEST) {
      const seed = JSON.parse(readFileSync(env.IMPORT_SEED_MANIFEST, 'utf8'));
      env.IMPORT_SEED_PATH = seed.executable;
      env.IMPORT_SEED_VERSION = seed.version;
      env.IMPORT_SEED_SHA256 = seed.hash;
    }
    if (args[0] === '--check-config') {
      process.stdout.write(
        readWorkerConfig(env).enabled ? 'worker_config_valid\n' : 'worker_disabled\n',
      );
    } else {
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      await runWorker(env, controller.signal);
    }
  }
} catch {
  if (!controller.signal.aborted) {
    process.stderr.write('worker_unavailable\n');
    process.exitCode = 1;
  }
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
