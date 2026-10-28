import React from 'react';
import { createRoot } from 'react-dom/client';
// The web portal's stylesheet and fonts: same look as the J.N.N Campus Connect site.
import '../../client/src/index.css';
import App from './App.jsx';

// Follow the Windows light / dark setting, like the portal does.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
