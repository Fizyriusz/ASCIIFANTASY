import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@rpg/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@rpg/world': fileURLToPath(new URL('./packages/world/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
