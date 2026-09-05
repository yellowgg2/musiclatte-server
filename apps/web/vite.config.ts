import { defineConfig, loadEnv } from 'vite';
import { readWebConfig } from './src/config.ts';

export default defineConfig(({ mode }) => {
  const config = readWebConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  return { base: config.base, server: { host: '127.0.0.1', port: 5173, strictPort: true }, css: { modules: { localsConvention: 'camelCaseOnly' } } };
});
