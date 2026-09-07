import {
  metadataWorkerHealth,
  readMetadataWorkerConfig,
  runMetadataWorker,
} from './metadata-worker-runtime.js';

const controller = new AbortController();
const stop = () => controller.abort();
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--check-config', '--healthcheck'].includes(args[0]!)))
    throw new Error();
  if (args[0] === '--healthcheck') process.exitCode = metadataWorkerHealth(process.env) ? 0 : 1;
  else if (args[0] === '--check-config')
    process.stdout.write(
      readMetadataWorkerConfig(process.env).enabled
        ? 'metadata_config_valid\n'
        : 'metadata_disabled\n',
    );
  else {
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    await runMetadataWorker(process.env, controller.signal);
  }
} catch {
  if (!controller.signal.aborted) {
    process.stderr.write('metadata_worker_unavailable\n');
    process.exitCode = 1;
  }
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
