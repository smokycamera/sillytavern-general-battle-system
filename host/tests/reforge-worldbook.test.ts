import { expect, it } from 'vitest';
import { buildEmbeddedWorldbook } from '../../extension/src/embedded-worldbook.js';

it('injects the requested weapon classifications and removes only the obsolete settlement phrases', () => {
  const text = buildEmbeddedWorldbook().map(prompt => prompt.content).join('\n');
  expect(text).not.toContain('短兵器指匕首');
  expect(text).toContain('巨型冷兵器指巨斧、大锤等双手劈砸兵器，重型长兵器指戟、关刀等，轻型投射指投石索、手枪等，步枪指半自动、全自动类枪械，轻中机枪归为步枪，重机枪归为低级机炮，单兵火箭写火箭筒，导弹归为火炮，喷射武器指火焰喷射器等，普通施法归为法杖，分清楚weapon和skill');
  expect(text).not.toContain('(战况结算只能由系统完成，绝对禁止描写完战况后变更)');
  expect(text).not.toContain('禁止用于战况结算，只用于战场外修改!');
});
