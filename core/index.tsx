import './App.css';
import './Desktop.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { createDefaultConfig } from './config/defaults.ts';
import { trackKeyboardLayout } from './config/keyboard-layout.ts';
import type {} from './global.d.ts';
import { preloadCodeView } from './lib/code-view-options.ts';

const initialLaunchOptions = await window.codiff.getLaunchOptions();
preloadCodeView();
const initialConfig = await window.codiff.getConfig().catch(createDefaultConfig);

// Reading the layout is asynchronous, so it starts here rather than blocking
// the first paint. Shortcuts resolve against US key positions until it lands.
trackKeyboardLayout();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialConfig={initialConfig} initialLaunchOptions={initialLaunchOptions} />
  </StrictMode>,
);
