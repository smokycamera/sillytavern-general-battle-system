import { defineConfig } from 'vite';
export default defineConfig({ build: {
  outDir: 'release/native-host-probe', emptyOutDir: true, minify: false,
  lib: { entry: 'scripts/native-host-probe.ts', formats: ['es'], fileName: () => 'index.js' },
} });
