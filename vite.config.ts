import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served from https://arsylk.github.io/js-defuse-web/ — Vite needs the sub-path
// for asset URLs and the worker URL.
export default defineConfig({
  base: '/js-defuse-web/',
  plugins: [react(), tailwindcss()],
  define: {
    // Babel's packages read a few process.env flags; there is no process here.
    'process.env.BABEL_TYPES_8_BREAKING': 'false',
    'process.env.BABEL_ENV': '"production"',
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
