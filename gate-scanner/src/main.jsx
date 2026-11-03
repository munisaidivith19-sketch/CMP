import React from 'react';
import { createRoot } from 'react-dom/client';
// The web portal's stylesheet and fonts: same look as the J.N.N Campus Connect site.
import '../../client/src/index.css';
import App from './App.jsx';
import { applyTheme, readTheme } from './lib/theme.js';
import ErrorBoundary from './ErrorBoundary.jsx';

// Saved choice (Light / Dark), otherwise follow the Windows light / dark setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
applyTheme(readTheme());
dark.addEventListener('change', () => applyTheme(readTheme()));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
