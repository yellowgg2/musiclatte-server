// Synthetic inline cover: no music library data or network dependency.
export const galleryFixtureId = 'MUSICLATTE_GALLERY_V0';
export const galleryCover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#ded8e9"/><circle cx="173" cy="62" r="29" fill="#f8eedc"/><path d="M0 157Q66 90 129 153T240 129V240H0Z" fill="#9b8ead"/><path d="M0 191Q73 147 141 181T240 172V240H0Z" fill="#695b7d"/><path d="M99 159v-46l39-8v46m-39-26 39-8" fill="none" stroke="#fff8eb" stroke-width="4"/><ellipse cx="90" cy="161" rx="10" ry="7" fill="#fff8eb"/><ellipse cx="129" cy="153" rx="10" ry="7" fill="#fff8eb"/></svg>')}`;
export const galleryBrokenCover = 'data:image/png;base64,broken';
export const gallerySwatches = [
  'background',
  'surface',
  'text',
  'secondaryText',
  'accent',
  'selection',
] as const;
