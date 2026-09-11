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
  it('declares the v23 organization recovery ledger without public route exposure', () => {
    const migration = readFileSync(
      'apps/api/src/storage/migrations/023-metadata-organization.sql',
      'utf8',
    );
    for (const table of [
      'organization_jobs',
      'organization_items',
      'organization_attempts',
      'organization_reference_checkpoints',
      'organization_source_locations',
    ])
      expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toContain('PRAGMA user_version=23');
    expect(readFileSync('apps/api/src/app.ts', 'utf8')).not.toContain(
      'routes/metadata-organization',
    );
  });
});
