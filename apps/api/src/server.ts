import { readConfig } from './app.js';
import { createConfiguredApp } from './auth/runtime.js';

try {
  const config = readConfig(process.env);
  const app = createConfiguredApp(process.env);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  }
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  console.info('Musiclatte API listening on port %d', config.port);
} catch {
  console.error(
    'API startup failed; check runtime/authentication configuration and port availability.',
  );
  process.exitCode = 1;
}
