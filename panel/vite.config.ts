import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 构建为单文件 HTML（酒馆助手脚本直接导入）
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    modulePreload: false,
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
  },
});
