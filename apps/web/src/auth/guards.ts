import { metadataPageRoute } from '../metadata/routes';
import { isRecentPath } from '../recent/routes';
import { isImportsPath } from '../imports/routes';
import { musicRoute } from '../music/queries';
import { playlistRoute } from '../playlists/routes';
import { isFavoritesPath } from '../favorites/routes';
/** Only implemented canonical relative routes can be restored after authentication. */
export function safeReturnPath(
  value: string | null | undefined,
  base = '/',
  fallbackPage: 'music' | 'playlists' | 'settings' = 'music',
): string {
  const fallback = `${base}${fallbackPage}`;
  if (!value || !value.startsWith(base) || value.startsWith('//') || /[\\#\x00-\x1f]/.test(value))
    return fallback;
  if (metadataPageRoute(value, base)) return value;
  if (value === `${base}settings` || isImportsPath(value, base)) return value;
  if (isRecentPath(value, base)) return value;
  if (isFavoritesPath(value, base)) return value;
  const playlist = playlistRoute(value, base);
  if (playlist) return value;
  const route = musicRoute(value, base);
  if (!route) return fallback;
  const allowed =
    route.kind === 'search'
      ? ['q', 'musicFolderId', 'songOffset', 'artistOffset', 'albumOffset']
      : ['musicFolderId'];
  for (const key of route.query.keys())
    if (!allowed.includes(key) || route.query.getAll(key).length !== 1) return fallback;
  const path = value.split('?')[0]!;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return fallback;
  return value;
}
export function isSettingsPath(path: string, base: string): boolean {
  return path === `${base}settings` || path === `${base}settings/`;
}
