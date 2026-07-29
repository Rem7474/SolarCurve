import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // En dev local, les routes /api/* doivent être fournies par un proxy same-origin
      // (voir readme.md — "Déploiement production"). Adapter la cible ci-dessous si vous
      // faites tourner un proxy local pendant le développement.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
