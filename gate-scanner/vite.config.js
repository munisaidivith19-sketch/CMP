import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is loaded from disk (file://) by Electron, so asset paths are
// relative. It imports the web client's stylesheet and gate-QR helpers
// directly (../client/src), so React is pinned to this package's copy.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'], legalComments: 'none' } : undefined,
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
}));
