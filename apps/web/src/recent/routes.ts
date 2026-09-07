/** Period and opaque cursor state stay in memory, never in the UI URL. */
export function isRecentPath(value: string, base = '/'): boolean {
  return value === `${base}music/recent` || value === `${base}music/recent/`;
}
