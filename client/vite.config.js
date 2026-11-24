import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_API_PROXY || 'http://localhost:5000';

// Vendor libraries split into their own long-cached chunks.
const vendorChunk = (pkgs) => new RegExp(`[\\\\/]node_modules[\\\\/](${pkgs.join('|')})[\\\\/]`);

// Production bundles (app and web worker) carry no console / debugger
// statements (no stray data in the browser console) and no license comments.
const productionOutput = (mode) =>
  mode === 'production'
    ? { minify: { compress: { dropConsole: true, dropDebugger: true } }, comments: { legal: false } }
    : {};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // In development every /api, /uploads and /socket.io request is proxied to the
  // Express server, so the browser sees a single origin (cookies just work).
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
      '/socket.io': { target: API, changeOrigin: true, ws: true },
    },
  },
  // The bus map's MapLibre worker is bundled into one same-origin file
  // (?worker&url), so the CSP never needs blob: or remote scripts for it.
  worker: {
    format: 'es',
    rolldownOptions: { output: productionOutput(mode) },
  },
  build: {
    // Never publish source maps: they would hand out the original source.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        ...productionOutput(mode),
        codeSplitting: {
          groups: [
            { name: 'react', test: vendorChunk(['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler']) },
            { name: 'redux', test: vendorChunk(['@reduxjs/toolkit', 'react-redux', 'redux', 'immer', 'reselect']) },
            { name: 'charts', test: vendorChunk(['recharts', 'd3-[a-z]+', 'victory-vendor']) },
          ],
        },
      },
    },
  },
}));
