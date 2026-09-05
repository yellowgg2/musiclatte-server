import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
// Product UI starts only after the S05 component Gallery is approved.
createRoot(root).render(null);
