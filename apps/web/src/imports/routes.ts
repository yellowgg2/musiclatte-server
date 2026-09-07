/** Imports has no URL input, query state or detail route. */
export function isImportsPath(value: string, base = '/'): boolean {
  return value === `${base}imports` || value === `${base}imports/`;
}
