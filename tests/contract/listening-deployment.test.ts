import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const flags = [
  'MIXES_ENABLED',
  'LISTENING_ENABLED',
  'LISTENING_SCROBBLE_ENABLED',
  'STREAM_QUALITY_ENABLED',
  'ARTIST_INFO_ENABLED',
] as const;
function config(extra: string[] = []) {
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

describe('listening feature deployment', () => {
  it('keeps every extension false in base Compose and exposes strict public examples', () => {
    const base = config();
    for (const flag of flags) expect(base.services.api.environment[flag]).toBe('false');
    const env = readFileSync('.env.example', 'utf8');
    for (const flag of flags) expect(env).toContain(`${flag}=false`);
  });

  it('enables the complete API combination without changing gonic or adding a worker', () => {
    expect(existsSync('deploy/compose.listening.yaml')).toBe(true);
    const base = config();
    const enabled = config(['-f', 'deploy/compose.listening.yaml']);
    for (const flag of flags) expect(enabled.services.api.environment[flag]).toBe('true');
    expect(enabled.services.gonic).toEqual(base.services.gonic);
    expect(Object.keys(enabled.services).sort()).toEqual(Object.keys(base.services).sort());
    expect(enabled.services.api.volumes).toEqual(base.services.api.volumes);
  });

  it('documents scrobble, flag-off schema retention, and matching restore in both languages', () => {
    for (const path of ['README.md', 'README.ko.md', 'deploy/backup/README.md']) {
      const text = readFileSync(path, 'utf8');
      expect(text).toContain('compose.listening.yaml');
    }
    expect(readFileSync('README.md', 'utf8')).toContain('scrobble');
    expect(readFileSync('README.ko.md', 'utf8')).toContain('scrobble');
    const backup = readFileSync('deploy/backup/README.md', 'utf8');
    expect(backup).toContain('schema v21');
    expect(backup).toContain('dispatching');
    expect(backup).toContain('uncertain');
  });
});
