import { expect, it } from 'vitest';
import { buildEmbeddedWorldbook } from '../../extension/src/embedded-worldbook.js';

it('injects the requested weapon classifications and removes only the obsolete settlement phrases', () => {
  const text = buildEmbeddedWorldbook().map(prompt => prompt.content).join('\n');
  expect(text).not.toContain('短兵器指匕首');
  expect(text).toContain('巨斧、大锤等双手劈砸兵器归巨型冷兵器；戟、关刀等归重型长兵器；投石索、手枪等归轻型投射；半自动、全自动枪械及轻中机枪归步枪；重机枪归低级机炮；单兵火箭归火箭筒，导弹归火炮；火焰喷射器等归喷射武器，普通施法武器归法杖。');
  expect(text).not.toContain('(战况结算只能由系统完成，绝对禁止描写完战况后变更)');
  expect(text).not.toContain('禁止用于战况结算，只用于战场外修改!');
});
