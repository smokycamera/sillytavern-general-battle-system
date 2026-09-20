import { existsSync, readFileSync } from 'node:fs';

// Keep the user-supplied release intact until its newer changes exist in source.
const baselinePath = new URL('../release/current-baseline.json', import.meta.url);
if (existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (baseline.sourceStatus === 'artifact-only') {
    throw new Error(
      '当前交付是用户提供的新版脚本，工作区源码尚未同步，已停止构建以免覆盖新版。' +
      '请先对齐源码并验证，再更新 release/current-baseline.json 的 sourceStatus。' +
      '详见 docs/script-baseline-20260919.md。',
    );
  }
}
