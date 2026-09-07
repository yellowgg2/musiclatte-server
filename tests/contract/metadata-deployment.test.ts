import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('metadata deployment boundary', () => {
  /** Worker and API use one pinned artifact with separate entrypoints and mount privileges. */
  it('should declare opt-in metadata targets and a private worker-only backup store', () => {
    expect(existsSync('deploy/metadata.Dockerfile')).toBe(true);
    const image = readFileSync('deploy/metadata.Dockerfile', 'utf8');
    expect(image).toContain('node:24.20.0-bookworm-slim');
    expect(image).toContain('--require-hashes');
    expect(image).toContain('AS api');
    expect(image).toContain('AS worker');
    expect(image).not.toContain('yt-dlp');
    const overlay = readFileSync('deploy/compose.metadata.yaml', 'utf8');
    expect(overlay).toContain('metadata-worker:');
    expect(overlay).toContain('read_only: true');
    expect(overlay).not.toContain('docker.sock');
    expect(overlay).not.toContain('IMPORT_CREDENTIAL');
    expect(readFileSync('apps/api/package.json', 'utf8')).toContain('start:metadata-worker');
  });
});
