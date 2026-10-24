import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { mkdirSync } from 'node:fs';

// Bundle first: vite-node's live module bindings add substantial overhead to hot
// combat loops and do not represent the installed extension's bundled execution.
// Optional baseline ref substitutes the optimized implementation files together.
const ref = process.argv[2], directory = process.env.BENCH_DIR ?? 'artifacts/ai-skills';
mkdirSync(directory, { recursive: true });
for (const mode of ref ? ['before', 'after'] : ['after']) {
  const plugins = mode === 'before' ? [{ name: 'baseline', setup(builder) {
    builder.onLoad({ filter: /engine[\\/]src[\\/](damage|power-anchors|skill-tactics|skill-effects|small[\\/]battle)\.ts$/ }, args => ({
      contents: execFileSync('git', ['show', ref + ':' + relative(process.cwd(), args.path).split(sep).join('/')], { encoding: 'utf8' }), loader: 'ts',
    }));
  } }] : [];
  const outfile = `${directory}/${mode}.mjs`;
  await build({ entryPoints: ['scripts/benchmark-ai-skills.ts'], bundle: true, platform: 'node', format: 'esm', outfile, plugins });
  const result = spawnSync(process.execPath, [outfile, `${directory}/${mode}.json`], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
