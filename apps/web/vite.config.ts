import { defineConfig, loadEnv } from 'vite';
import { readWebConfig } from './src/config.ts';

export default defineConfig(({ mode, command }) => {
  const config = readWebConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  const target =
    command === 'serve'
      ? (process.env.MUSICLATTE_PREVIEW_API_TARGET ?? 'http://127.0.0.1:3000')
      : 'http://127.0.0.1:3000';
  const upstream = new URL(target);
  if (
    upstream.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname) ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== '/' ||
    upstream.search ||
    upstream.hash
  )
    throw new Error('Invalid preview API target');
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
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/.well-known/musiclatte-server': { target, changeOrigin: false },
      },
    },
    css: { modules: { localsConvention: 'camelCaseOnly' } },
  };
});
