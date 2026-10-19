import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY || 'http://localhost:5000';

// In development every /api, /uploads and /socket.io request is proxied to the
// Express server, so the browser sees a single origin (cookies just work).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
      '/socket.io': { target: API, changeOrigin: true, ws: true },
    },
  },
  // Production bundles carry no console / debugger statements (no stray data
  // in the browser console) and no license comment blocks.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'], legalComments: 'none' } : undefined,
  // The bus map's MapLibre worker is bundled into one same-origin file
  // (?worker&url), so the CSP never needs blob: or remote scripts for it.
  worker: { format: 'es' },
  build: {
    // Never publish source maps: they would hand out the original source.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
          charts: ['recharts'],
        },
      },
    },
  },
}));
