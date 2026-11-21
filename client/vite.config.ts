import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const GAME = process.env.GAME_ADDR ?? '127.0.0.1:8080';

export default defineConfig({
  root,
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': `http://${GAME}`,
      '/healthz': `http://${GAME}`,
      '/ws': { target: `ws://${GAME}`, ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
