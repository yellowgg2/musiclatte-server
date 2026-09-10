/** Process liveness only; this does not indicate upstream readiness. */
export interface HealthResponse {
  status: 'ok';
}
export type * from './subsonic.js';
export * from './collections.js';
export * from './session.js';
export * from './capabilities.js';
export * from './api-error.js';

export * from './music.js';
export * from './media.js';

export * from './imports.js';

export * from './recent.js';

export * from './engine.js';
export * from './metadata.js';

export * from './scan.js';
export * from './access-tokens.js';

export * from './curation.js';

export * from './automation.js';
export * from './mixes.js';
export * from './listening.js';
export * from './artist-info.js';
