import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@rpg/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@rpg/world': fileURLToPath(new URL('./packages/world/src/index.ts', import.meta.url)),
      '@rpg/content': fileURLToPath(new URL('./packages/content/src/index.ts', import.meta.url)),
      '@rpg/rules': fileURLToPath(new URL('./packages/rules/src/index.ts', import.meta.url)),
      '@rpg/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
