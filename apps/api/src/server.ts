import { createApp, readConfig } from './app.js';

try {
  const config = readConfig(process.env);
  const app = createApp();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => { process.exitCode = 1; });
    });
  }
  await app.listen({ host: config.host, port: config.port });
  console.info('Musiclatte API listening on port %d', config.port);
} catch {
  console.error('API startup failed; check HOST, PORT, NODE_ENV and port availability.');
  process.exitCode = 1;
}
