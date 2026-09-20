import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'engine/src'),
    },
  },
  test: {
    globals: true,
    include: ['engine/tests/**/*.test.ts', 'panel/src/**/*.test.ts', 'host/**/*.test.ts', 'runtime/**/*.test.ts'],
  },
});
