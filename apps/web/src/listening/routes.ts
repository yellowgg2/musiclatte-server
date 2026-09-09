export function listeningRoute(path: string, base: string): 'history' | 'top' | null {
  const pathname = path.split('?')[0]?.replace(/\/$/, '');
  if (pathname === `${base}music/history`) return 'history';
  if (pathname === `${base}music/top`) return 'top';
  return null;
}
