/** Pure allowlist: no network requests, redirects or downloader-specific selectors. */
export function parseYouTubeSource(input: string): { videoId: string; canonicalUrl: string } {
  const invalid = () => new Error('invalid_source');
  if (typeof input !== 'string' || input.length > 2048 || /[\s\\#]/u.test(input)) throw invalid();
  const match =
    /^https:\/\/(www\.youtube\.com|music\.youtube\.com|m\.youtube\.com|youtube\.com|youtu\.be)(\/[^?]*)(?:\?(.*))?$/.exec(
      input,
    );
  if (!match) throw invalid();
  const [, host, path, query] = match;
  const params = new URLSearchParams(query);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw invalid();
  let videoId: string | undefined;
  if (host !== 'youtu.be' && path === '/watch') videoId = params.get('v') ?? undefined;
  else if (host === 'youtu.be') videoId = /^\/([A-Za-z0-9_-]{11})$/.exec(path!)?.[1];
  else videoId = /^\/shorts\/([A-Za-z0-9_-]{11})$/.exec(path!)?.[1];
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw invalid();
  for (const [key, value] of params) {
    if (key === 'v' && host !== 'youtu.be' && path === '/watch' && query?.includes(`v=${videoId}`))
      continue;
    if (key === 't' && /^(?:\d{1,6}|(?:\d{1,3}h)?(?:\d{1,3}m)?\d{1,3}s)$/.test(value)) continue;
    if (key === 'si' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) continue;
    throw invalid();
  }
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}
