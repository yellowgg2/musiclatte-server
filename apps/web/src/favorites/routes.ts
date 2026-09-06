export function isFavoritesPath(value: string, base = '/'): boolean {
  const [path, search = ''] = value.split('?');
  return (path === `${base}music/favorites` || path === `${base}music/favorites/`) && !search;
}

export function favoritesHref(base = '/'): string {
  return `${base}music/favorites`;
}
