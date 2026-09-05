import { createRoot } from 'react-dom/client';
const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');
const root = createRoot(element);
// Product UI starts only after the S05 component Gallery is approved.
root.render(null);
if (
  import.meta.env.DEV &&
  window.location.pathname === `${import.meta.env.BASE_URL}__dev/gallery`
) {
  void import('./dev/Gallery').then(({ Gallery }) => root.render(<Gallery />));
}
