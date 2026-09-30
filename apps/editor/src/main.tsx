import { createRoot } from 'react-dom/client';
import App from './App';
import { installWindowShortcuts } from './lib/shortcuts';
import { wireEditor } from './state/controller';
import './styles.css';

wireEditor();
installWindowShortcuts();
createRoot(document.getElementById('root')!).render(<App />);

// Exposed for end-to-end tests and debugging from the console.
(window as unknown as { __pf: unknown }).__pf = { store: (await import('./state/store')).useEditor };
