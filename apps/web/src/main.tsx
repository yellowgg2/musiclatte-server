import { Router } from './app/Router';
import { readWebConfig } from './config';
import { createRoot } from 'react-dom/client';
const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');
const root = createRoot(element);
const config = readWebConfig(import.meta.env);
if (
  import.meta.env.DEV &&
  window.location.pathname === `${import.meta.env.BASE_URL}__dev/gallery`
) {
  void import('./dev/Gallery').then(({ Gallery }) => root.render(<Gallery />));
} else if (
  import.meta.env.DEV &&
  window.location.pathname === `${import.meta.env.BASE_URL}__dev/shell`
) {
  void import('./dev/ShellFixture').then(({ ShellFixture }) => root.render(<ShellFixture />));
} else if (
  import.meta.env.DEV &&
  window.location.pathname === `${import.meta.env.BASE_URL}__dev/audio-probe`
) {
  void import('./dev/AudioProbe').then(({ AudioProbe }) => root.render(<AudioProbe />));
} else {
  root.render(<Router base={config.base} apiOrigin={config.apiOrigin} />);
}
