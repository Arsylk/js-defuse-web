import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages caches index.html for ten minutes, so a tab opened before a
// deploy keeps the previous build. The page embeds this id and compares it
// with version.txt (fetched past the cache) to offer a reload.
const buildId = (() => {
  const sha = process.env.GITHUB_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() + '-local';
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
})();

const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.txt', source: `${buildId}\n` });
  },
});

// Served from https://arsylk.github.io/js-defuse-web/ — Vite needs the sub-path
// for asset URLs and the worker URL.
export default defineConfig({
  base: '/js-defuse-web/',
  plugins: [react(), tailwindcss(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
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
