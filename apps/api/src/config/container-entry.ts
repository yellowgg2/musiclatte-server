import { initializeContainerStorage } from './runtime.js';
try {
  initializeContainerStorage(
    process.env.MANAGEMENT_DIRECTORY ?? '',
    process.env.CREDENTIAL_KEY_PATH ?? '',
  );
  await import('../server.js');
} catch {
  process.stderr.write('Container startup failed; check configuration and storage permissions\n');
  process.exitCode = 1;
}
