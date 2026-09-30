import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pixelforge/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@pixelforge/codegen': path.resolve(__dirname, 'packages/codegen/src/index.ts'),
      '@pixelforge/vite-plugin': path.resolve(__dirname, 'packages/vite-plugin/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
