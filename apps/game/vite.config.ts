import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@rpg/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@rpg/world': fileURLToPath(new URL('../../packages/world/src/index.ts', import.meta.url)),
    },
  },
  // Vercel szuka artefaktu w korzeniu repo (Root Directory = korzeń), więc build
  // celuje tam zamiast w apps/game/dist. emptyOutDir jest wymagane, bo katalog
  // leży poza rootem projektu vite i bez tego vite odmówi jego czyszczenia.
  build: { outDir: '../../dist', emptyOutDir: true },
});
