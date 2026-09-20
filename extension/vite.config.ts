import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  base: './',
  plugins: [{ name: 'native-panel-runtime', enforce: 'pre', resolveId(source, importer) {
    if (source === './panel-runtime.js' && importer?.replaceAll('\\', '/').endsWith('/panel/src/main.ts')) return path.resolve('extension/src/panel-runtime.ts');
  } }],
  build: {
    outDir: 'release/native-candidate', emptyOutDir: true, target: 'es2022',
    rollupOptions: {
      input: { index: path.resolve('extension/src/index.ts'), panel: path.resolve('panel/index.html') },
      output: { entryFileNames: chunk => chunk.name === 'index' ? 'index.js' : 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
});
