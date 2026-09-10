export type MusicRoute = {
  kind: 'folders' | 'folder' | 'search' | 'artist' | 'album';
  id?: string;
  query: URLSearchParams;
};
export function musicRoute(location: string, base = '/'): MusicRoute | null {
  const [path, search = ''] = location.split('?');
  const prefix = `${base}music`;
  const query = new URLSearchParams(search);
  if (path === prefix || path === `${prefix}/`) return { kind: 'folders', query };
  if (path === `${prefix}/search`) return { kind: 'search', query };
  const match = path?.slice(prefix.length).match(/^\/(folders|artists|albums)\/([^/]+)$/);
  if (!path?.startsWith(prefix) || !match) return null;
  try {
    const id = decodeURIComponent(match[2]!);
    if (!id || id === '.' || id === '..' || id.length > 2048) return null;
    const kind = match[1] === 'folders' ? 'folder' : match[1] === 'artists' ? 'artist' : 'album';
    return { kind, id, query };
  } catch {
    return null;
  }
}
export function musicHref(
  base: string,
  kind: MusicRoute['kind'],
  id?: string,
  query = new URLSearchParams(),
) {
  const segment = {
    folders: '',
    folder: '/folders/',
    search: '/search',
    artist: '/artists/',
    album: '/albums/',
  }[kind];
  const suffix = query.toString();
  return `${base}music${segment}${id === undefined ? '' : encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`;
}

function isDotSegment(value: string): boolean {
  let decoded = value;
  for (let depth = 0; depth < 3; depth++) {
    if (decoded === '.' || decoded === '..') return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return false;
      decoded = next;
    } catch {
      return true;
    }
  }
  return decoded === '.' || decoded === '..';
}

/** Rebuild a folder route without copying unrelated query state into a search origin. */
export function createSearchReturnTo(base: string, route: MusicRoute): string | null {
  if (route.kind !== 'folder' || !route.id) return null;
  return musicHref(base, 'folder', route.id, scopeQuery(route.query));
}

/** Validate one nested search origin and return its canonical folder/music-start href. */
export function parseSearchReturnTo(query: URLSearchParams, base = '/'): string | null {
  const values = query.getAll('returnTo');
  if (values.length !== 1) return null;
  const value = values[0]!;
  if (!value.startsWith(base) || value.startsWith('//') || /[\\#\x00-\x1f\x7f]/.test(value))
    return null;
  const path = value.split('?')[0]!;
  if (path.includes('//') || path.split('/').some(isDotSegment)) return null;
  const route = musicRoute(value, base);
  if (!route || (route.kind !== 'folder' && route.kind !== 'folders')) return null;
  if (route.id && /[\\#\x00-\x1f\x7f]/.test(route.id)) return null;
  for (const key of route.query.keys())
    if (key !== 'musicFolderId' || route.query.getAll(key).length !== 1) return null;
  const scopeId = route.query.get('musicFolderId');
  if (scopeId !== null && (!scopeId || scopeId.length > 2048 || /[\\#\x00-\x1f\x7f]/.test(scopeId)))
    return null;
  return musicHref(base, route.kind, route.id, scopeQuery(route.query));
}

export function scopeQuery(query: URLSearchParams) {
  const scope = new URLSearchParams();
  const id = query.get('musicFolderId');
  if (id) scope.set('musicFolderId', id);
  return scope;
}
export function pageOffset(query: URLSearchParams, kind: 'artist' | 'album' | 'song') {
  const value = query.get(`${kind}Offset`) ?? '0';
  const number = Number(value);
  return /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(number) ? number : 0;
}
