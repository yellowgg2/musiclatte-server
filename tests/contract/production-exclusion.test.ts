import {
  cpSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer, preview } from 'vite';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('development Gallery boundary', () => {
  /** Gallery is reachable in development for either configured SPA base. */
  it.each(['/', '/music/'])('should serve the development entry under %s', async (base) => {
    expect(existsSync('apps/web/src/dev/Gallery.tsx'), 'actual shared Gallery renderer').toBe(true);
    const server = await createServer({
      root: resolve('apps/web'),
      base,
      server: { port: 0, strictPort: false },
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await server.listen();
      const origin = server.resolvedUrls!.local[0]!;
      const entry = await fetch(new URL('src/main.tsx', origin)).then((r) => r.text());
      expect(entry.includes('DEV')).toBe(true);
      expect(entry).toContain('dev/Gallery');
      expect((await fetch(new URL('__dev/gallery', origin))).status).toBe(200);
    } finally {
      await server.close();
    }
  });
  /** Production output excludes every dev module and rejects dev paths before SPA fallback. */
  it.each(['/', '/music/'])('should exclude Gallery modules and serving under %s', async (base) => {
    expect(existsSync('apps/web/src/dev/Gallery.tsx'), 'actual shared Gallery renderer').toBe(true);
    const output = mkdtempSync(join(tmpdir(), 'musiclatte-gallery-'));
    try {
      execFileSync(
        process.execPath,
        [
          resolve('node_modules/vite/bin/vite.js'),
          'build',
          '--base',
          base,
          '--outDir',
          output,
          '--manifest',
          '--sourcemap',
        ],
        {
          cwd: resolve('apps/web'),
          env: { ...process.env, NODE_ENV: 'production' },
          stdio: 'pipe',
        },
      );
      for (const file of readdirSync(join(output, 'assets'))) {
        const content = readFileSync(join(output, 'assets', file), 'utf8');
        expect(content.includes('MUSICLATTE_GALLERY_V0')).toBe(false);
        expect(content.includes('Music shell fixture')).toBe(false);
        if (!file.endsWith('.map')) expect(content.includes('__dev/gallery')).toBe(false);
        if (file.endsWith('.map')) {
          const map = JSON.parse(content) as { sources: string[] };
          expect(map.sources.filter((source) => source.includes('/src/dev/'))).toEqual([]);
        }
      }
      expect(readdirSync(output)).not.toContain('__dev');
      const server = await preview({
        root: resolve('apps/web'),
        base,
        logLevel: 'silent',
        build: { outDir: output },
        preview: { port: 0, strictPort: false },
      });
      try {
        const origin = server.resolvedUrls!.local[0]!;
        expect((await fetch(origin)).status).toBe(200);
        for (const path of [
          '__dev/gallery',
          '__dev/gallery/',
          '__dev/gallery?locale=en',
          '__dev/shell',
        ]) {
          expect((await fetch(new URL(path, origin))).status).toBe(404);
        }
      } finally {
        await new Promise<void>((done, reject) =>
          server.httpServer.close((error) => (error ? reject(error) : done())),
        );
      }
      expect(readFileSync(join(output, '.vite/manifest.json'), 'utf8')).not.toContain('Gallery');
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
  /** A source-only container build must succeed with the entire development tree removed. */
  it('should build from a context without Gallery source or fixtures', () => {
    expect(readFileSync('.dockerignore', 'utf8').includes('apps/web/src/dev')).toBe(true);
    const context = mkdtempSync(join(tmpdir(), 'musiclatte-web-context-'));
    try {
      mkdirSync(join(context, 'apps/web'), { recursive: true });
      cpSync('apps/web', join(context, 'apps/web'), {
        recursive: true,
        filter: (source) => !/(?:^|\/)(?:dev|dist|test|node_modules)(?:\/|$)/.test(source),
      });
      cpSync('tsconfig.base.json', join(context, 'tsconfig.base.json'));
      cpSync('package.json', join(context, 'package.json'));
      symlinkSync(resolve('node_modules'), join(context, 'node_modules'), 'dir');
      execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], {
        cwd: join(context, 'apps/web'),
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      });
      expect(existsSync(join(context, 'apps/web/dist/index.html'))).toBe(true);
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  });
});
