// 体系×场景矩阵模拟专用配置：npx vitest run --config vitest.sim.config.ts
// 不并入默认 include，避免拖慢常规 npm test。
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
    include: ['engine/sim/**/*.sim.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
