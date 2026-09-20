import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { importedFileNames, importedPanelModule } from './scripts/imported-baseline-oracle.mjs';

const files = new Set(importedFileNames);
const root = path.resolve('.');
export default defineConfig({
  plugins: [{ name: 'frozen-user-artifact-oracle', enforce: 'pre', load(id) {
    const file = path.relative(root, id.split('?')[0]!).replaceAll('\\', '/');
    if (!files.has(file) || !file.endsWith('.ts') || file.endsWith('/main.ts')) return;
    const keys = Object.keys(importedPanelModule(file));
    return `import { importedPanelModule } from ${JSON.stringify(path.resolve('scripts/imported-baseline-oracle.mjs').replaceAll('\\', '/'))};\nconst mod = importedPanelModule(${JSON.stringify(file)});\n` + keys.map(key => key === 'default' ? 'export default mod.default;' : `export const ${key} = mod[${JSON.stringify(key)}];`).join('\n');
  } }],
  test: { globals: true, maxWorkers: 2, minWorkers: 1, include: ['engine/tests/**/*.test.ts', 'panel/src/**/*.test.ts'] },
});
