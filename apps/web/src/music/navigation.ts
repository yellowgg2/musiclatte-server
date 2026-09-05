/** Store only viewport position in history; search/filter state belongs to the URL. */
export function navigateMusic(href: string) {
  window.history.replaceState({ ...window.history.state, musicScroll: window.scrollY }, '');
  window.history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
