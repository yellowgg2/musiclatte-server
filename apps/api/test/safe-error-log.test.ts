import { describe, expect, it } from 'vitest';
import { safeServerFailure } from '../src/app.js';

describe('safe server failure log', () => {
  it('should serialize only the controlled route template and error classification', () => {
    expect(
      safeServerFailure('GET', '/api/v1/media/cover/:id/revisions/:revision', 503, {
        code: 'upstream_unavailable',
      }),
    ).toBe(
      '{"event":"api_failure","method":"GET","route":"/api/v1/media/cover/:id/revisions/:revision","status":503,"code":"upstream_unavailable"}',
    );
  });
});
