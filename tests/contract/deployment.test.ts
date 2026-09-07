import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, 'utf8');
};
function makeSUT(extra: string[] = []) {
  read('compose.yaml');
  return JSON.parse(
    execFileSync(
      'docker',
      ['compose', '-f', 'compose.yaml', ...extra, 'config', '--format', 'json'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          MUSIC_PATH: '/tmp/synthetic-music',
          SESSION_MAX_AGE_SECONDS: '3600',
          PUBLIC_ORIGIN: 'https://music.example.test',
        },
      },
    ),
  );
}
describe('source-only deployment', () => {
  /** A fresh install publishes only loopback and pins the observed upstream digest. */
  it('should isolate services and persist separate state with read-only music', () => {
    const { services, volumes } = makeSUT();
    expect(Object.keys(services).sort()).toEqual(['api', 'gonic', 'volume-init', 'web']);
    expect(services.gonic.image).toBe(
      'sentriz/gonic@sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49',
    );
    for (const service of Object.values(services) as { ports?: { host_ip: string }[] }[])
      for (const port of service.ports ?? []) expect(port.host_ip).toBe('127.0.0.1');
    expect(services.api.ports).toBeUndefined();
    expect(
      services.gonic.volumes.find((v: { target: string }) => v.target === '/music').read_only,
    ).toBe(true);
    expect(Object.keys(volumes).sort()).toEqual([
      'gonic-cache',
      'gonic-data',
      'gonic-playlists',
      'gonic-podcasts',
      'management-data',
      'management-keys',
    ]);
    expect(services['volume-init'].network_mode).toBe('none');
    expect(services.gonic.depends_on['volume-init'].condition).toBe(
      'service_completed_successfully',
    );
    for (const service of [services.api, services.web, services.gonic]) {
      expect(service.restart).toBe('unless-stopped');
      expect(service.healthcheck).toBeDefined();
      expect(service.user).not.toBe('0');
    }
    expect(services.web.depends_on.api.condition).toBe('service_healthy');
    expect(services.gonic.logging.driver).toBe('none');
  });
  /** Build stages use the same exact toolchain and final artifacts exclude fixtures and dev dependencies. */
  it('should build only production artifacts under the pinned Node and npm contract', () => {
    for (const path of ['deploy/api.Dockerfile', 'deploy/web.Dockerfile']) {
      const source = read(path);
      expect(source).toContain('node:24.20.0-bookworm-slim');
      expect(source).toContain('11.19.0');
      expect(source).not.toMatch(/COPY\s+\.\s+\./);
      expect(source).not.toContain('npm install');
      const final = source.slice(source.lastIndexOf('\nFROM '));
      expect(final).not.toMatch(/COPY.*(?:test-support|tests|src|Gallery)/);
      expect(final).not.toContain('npm ci');
    }
    expect(read('deploy/api.Dockerfile')).toContain('--omit=dev');
    const ignored = read('.dockerignore');
    for (const path of [
      '**/AGENTS.md',
      '**/.env',
      '**/*.mp3',
      '**/test',
      'tests',
      'packages/test-support/src',
      'apps/web/src/**/Gallery*',
    ])
      expect(ignored).toContain(path);
  });

  /** Ensures the web image builds every workspace package imported by production UI code. */
  it('should build declared web workspace dependencies inside the image', () => {
    const source = read('deploy/web.Dockerfile');
    expect(source).toContain('COPY packages/contracts/src ./packages/contracts/src');
    expect(source).toContain(
      'COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json',
    );
    expect(source).toContain('npm run build -w @musiclatte/contracts');
  });

  /** Production web builds include the public brand assets referenced by the login and app shell. */
  it('should copy public brand assets into the web build stage', () => {
    expect(read('apps/web/public/icons/musiclatte-192.png')).not.toHaveLength(0);
    expect(read('deploy/web.Dockerfile')).toContain('COPY apps/web/public ./apps/web/public');
  });

  /** LAN exposure needs an explicit setup attestation and must leave the admin endpoint on loopback. */
  it('should reject unconfirmed LAN startup and malformed gateway options', () => {
    const entry = read('deploy/gateway-entry.sh');
    expect(entry).toContain('ADMIN_SETUP_COMPLETE');
    for (const env of [
      { LAN_DEVELOPMENT: 'true', ADMIN_SETUP_COMPLETE: 'false' },
      { WEB_UI_ENABLED: 'invalid' },
    ]) {
      expect(() =>
        execFileSync('sh', ['deploy/gateway-entry.sh'], {
          env: { ...process.env, ...env },
          stdio: 'pipe',
        }),
      ).toThrow();
    }
    const config = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '-f',
          'compose.yaml',
          '-f',
          'deploy/compose.lan-development.yaml',
          'config',
          '--format',
          'json',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            MUSIC_PATH: '/tmp/synthetic-music',
            SESSION_MAX_AGE_SECONDS: '3600',
            PUBLIC_ORIGIN: 'https://music.example.test',
            LAN_BIND_ADDRESS: '192.168.50.2',
            LAN_PUBLIC_ORIGIN: 'http://192.168.50.2:8081',
            ADMIN_SETUP_COMPLETE: 'true',
          },
        },
      ),
    );
    expect(config.services.api.environment.NODE_ENV).toBe('development');
    expect(
      config.services.gonic.ports.every(
        (port: { host_ip: string }) => port.host_ip === '127.0.0.1',
      ),
    ).toBe(true);
  });
  /** Public setup examples hold no account secrets and distinguish bootstrap, TLS and deliberate LAN development. */
  it('should document safe setup and non-destructive backup rollback in both languages', () => {
    const env = read('.env.example');
    expect(env).toContain('MUSIC_PATH=');
    expect(env).toContain('SESSION_MAX_AGE_SECONDS=');
    expect(env).not.toMatch(/(?:PASSWORD|TOKEN|SECRET)=\S+/);
    for (const path of ['README.md', 'README.ko.md']) {
      const doc = read(path);
      for (const term of [
        'git clone',
        'docker compose up -d --build',
        '127.0.0.1',
        'SSH',
        'HTTPS',
        'deploy/backup/README.md',
      ])
        expect(doc).toContain(term);
    }
    expect(read('deploy/backup/README.md')).toContain('policy revision');
    read('deploy/compose.test.yaml');
  });
});
