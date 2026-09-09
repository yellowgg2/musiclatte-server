import type { FastifyReply } from 'fastify';
import type { MediaOptions } from '../subsonic/client.js';
type Representation = Pick<MediaOptions, 'quality' | 'offset'>;
const prefix = (o: Representation) => `p7-${o.quality}-${o.offset ?? 0}-`;
/** Validators belong to a URL representation; raw upstream validators cannot cross qualities. */
export function qualityRequestHeaders(request: Request, options: Representation) {
  request.headers.delete('if-modified-since');
  for (const name of ['if-range', 'if-none-match']) {
    const value = request.headers.get(name);
    if (!value) continue;
    const marker = `"${prefix(options)}`;
    if (value.startsWith(marker) && value.endsWith('"')) {
      const raw = Buffer.from(value.slice(marker.length, -1), 'base64url').toString('utf8');
      if (
        raw.startsWith('modified:') &&
        Number.isFinite(Date.parse(raw.slice(9))) &&
        new Date(raw.slice(9)).toUTCString() === raw.slice(9)
      ) {
        request.headers.delete(name);
        request.headers.set(name === 'if-range' ? 'if-range' : 'if-modified-since', raw.slice(9));
      } else if (/^(W\/)?"[^"\r\n]*"$/.test(raw)) request.headers.set(name, raw);
      else {
        request.headers.delete(name);
        if (name === 'if-range') request.headers.delete('range');
      }
    } else {
      request.headers.delete(name);
      if (name === 'if-range') request.headers.delete('range');
    }
  }
  // A time-offset transcode is a fresh time representation, never a byte seek into the base.
  if (options.offset !== undefined && options.offset > 0)
    for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since'])
      request.headers.delete(name);
}
export function qualityResponseHeaders(
  response: Response,
  reply: FastifyReply,
  options: Representation,
) {
  const modified = response.headers.get('last-modified');
  const etag = response.headers.get('etag') ?? (modified ? `modified:${modified}` : null);
  if (etag) reply.header('ETag', `"${prefix(options)}${Buffer.from(etag).toString('base64url')}"`);
  reply.header('Cache-Control', 'private, no-cache');
}
