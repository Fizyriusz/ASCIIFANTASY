import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@rpg/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@rpg/world': fileURLToPath(new URL('../../packages/world/src/index.ts', import.meta.url)),
    },
  },
});
