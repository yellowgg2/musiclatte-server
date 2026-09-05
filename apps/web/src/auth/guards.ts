/** Only implemented, canonical relative routes can be restored after authentication. */
export function safeReturnPath(value: string | null | undefined, base = '/'): string {
  const fallback = `${base}settings`;
  return value === fallback ? value : fallback;
}
export function isSettingsPath(path: string, base: string): boolean {
  return path === `${base}settings` || path === `${base}settings/`;
}
