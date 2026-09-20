import { defineConfig } from 'vite';
export default defineConfig({ build: {
  outDir: 'panel/dist', emptyOutDir: false,
  lib: { entry: 'panel/src/controller-entry.ts', formats: ['iife'], name: 'TavernBattleResident', fileName: () => 'controller.js' },
} });
