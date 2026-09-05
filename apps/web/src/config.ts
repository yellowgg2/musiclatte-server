export function readWebConfig(env: Record<string, string | undefined>) {
  const base = env.VITE_APP_BASE ?? '/';
  const apiOrigin = env.VITE_API_ORIGIN ?? '';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('Invalid VITE_APP_BASE');
  if (apiOrigin !== '') {
    try {
      const url = new URL(apiOrigin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== apiOrigin) throw new Error();
    } catch { throw new Error('Invalid VITE_API_ORIGIN'); }
  }
  return { base, apiOrigin };
}
