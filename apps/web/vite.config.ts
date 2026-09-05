import { defineConfig, loadEnv } from 'vite';
import { readWebConfig } from './src/config.ts';

export default defineConfig(({ mode }) => {
  const config = readWebConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    base: config.base,
    plugins: [
      {
        name: 'exclude-development-routes',
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            const path = new URL(request.url ?? '/', 'http://localhost').pathname;
            if (/(?:^|\/)__dev(?:\/|$)/.test(path)) {
              response.statusCode = 404;
              response.end('Not found');
              return;
            }
            next();
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    css: { modules: { localsConvention: 'camelCaseOnly' } },
  };
});
