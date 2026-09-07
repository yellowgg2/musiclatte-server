const root = '/api/v1';
function segment(value: string) {
  if (
    !value ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new TypeError('Invalid metadata identifier');
  return encodeURIComponent(value);
}
export const metadataRoutes = {
  snapshot: (id: string) => `${root}/tracks/${segment(id)}/metadata`,
  frame: (id: string, frame: string) =>
    `${root}/tracks/${segment(id)}/metadata/cover/${segment(frame)}`,
  jobs: `${root}/metadata-jobs`,
  job: (id: string) => `${root}/metadata-jobs/${segment(id)}`,
  covers: `${root}/metadata-covers`,
  upload: (id: string) => `${root}/metadata-covers/${segment(id)}`,
  changes: `${root}/metadata-changes`,
  previews: `${root}/metadata-previews`,
  cover: (id: string, generation: string) => {
    if (generation.length > 1024 || !/^[A-Za-z0-9_.:-]+$/.test(generation))
      throw new TypeError('Invalid cover generation');
    return `${root}/media/cover/${segment(id)}/revisions/${segment(generation)}`;
  },
};

export function metadataPageRoute(
  location: string,
  base = '/',
): { kind: 'list' } | { kind: 'detail'; id: string } | undefined {
  if (location === `${base}metadata-jobs`) return { kind: 'list' };
  const prefix = `${base}metadata-jobs/`;
  if (!location.startsWith(prefix)) return;
  const value = location.slice(prefix.length);
  if (!value || /[/?#]/.test(value)) return;
  try {
    const id = decodeURIComponent(value);
    if (
      id === '.' ||
      id === '..' ||
      !/^[A-Za-z0-9_.:-]{1,1024}$/.test(id) ||
      encodeURIComponent(id) !== value
    )
      return;
    return { kind: 'detail', id };
  } catch {
    return;
  }
}
