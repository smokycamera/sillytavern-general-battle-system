import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
const ref = process.argv[2], directory = process.env.BENCH_DIR ?? 'artifacts/save-performance';
mkdirSync(directory, { recursive: true });
for (const mode of ref ? ['before', 'after'] : ['after']) {
  const plugins = mode === 'before' ? [{ name: 'baseline', setup(builder) {
    builder.onLoad({ filter: /(?:host|runtime)[\\/]src[\\/].*\.ts$/ }, args => ({ contents: execFileSync('git', ['show', `${ref}:${relative(process.cwd(),args.path).split(sep).join('/')}`], { encoding:'utf8' }), loader:'ts' }));
  } }] : [];
  const outfile = `${directory}/${mode}.mjs`;
  await build({ entryPoints:['scripts/benchmark-save.ts'], bundle:true, platform:'node', format:'esm', outfile, plugins });
  const result = spawnSync(process.execPath,[outfile,`${directory}/${mode}.json`],{stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
