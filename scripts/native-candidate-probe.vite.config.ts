import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'release/native-candidate-probe', emptyOutDir: true,
  lib: { entry: 'scripts/native-candidate-host-probe.ts', formats: ['es'], fileName: () => 'index.js' },
} });
