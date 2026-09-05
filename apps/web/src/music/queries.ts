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
