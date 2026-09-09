export function mixRoute(location: string, base: string): { id?: string } | null {
  const path = location.split('?')[0]!;
  if (path === `${base}music/mixes`) return {};
  const prefix = `${base}music/mixes/`;
  if (!path.startsWith(prefix)) return null;
  try {
    const id = decodeURIComponent(path.slice(prefix.length));
    return /^[0-9a-f-]{36}$/i.test(id) ? { id } : null;
  } catch {
    return null;
  }
}
