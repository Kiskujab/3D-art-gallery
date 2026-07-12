import { defineConfig } from 'vite';

export default defineConfig({
  // relative base: the same build works at the domain root, on GitHub Pages
  // under /<repo>/, and on the local preview server
  base: './',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
