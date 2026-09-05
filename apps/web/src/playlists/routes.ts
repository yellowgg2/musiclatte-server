export type PlaylistRoute = { kind: 'list' } | { kind: 'detail'; id: string };

export function playlistRoute(location: string, base = '/'): PlaylistRoute | null {
  const [path, search = ''] = location.split('?');
  const prefix = `${base}playlists`;
  if (search || !path?.startsWith(prefix)) return null;
  if (path === prefix || path === `${prefix}/`) return { kind: 'list' };
  const match = path.slice(prefix.length).match(/^\/([^/]+)$/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    if (!id || id === '.' || id === '..' || id.length > 2048) return null;
    return { kind: 'detail', id };
  } catch {
    return null;
  }
}

export function playlistHref(base: string, id?: string): string {
  return id === undefined ? `${base}playlists` : `${base}playlists/${encodeURIComponent(id)}`;
}
