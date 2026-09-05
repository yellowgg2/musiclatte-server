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
