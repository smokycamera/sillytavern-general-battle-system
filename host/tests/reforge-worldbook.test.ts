import { expect, it } from 'vitest';
import { buildEmbeddedWorldbook } from '../../extension/src/embedded-worldbook.js';

it('injects the requested weapon classifications and removes only the obsolete settlement phrases', () => {
  const text = buildEmbeddedWorldbook().map(prompt => prompt.content).join('\n');
  expect(text).toContain('轻型投射指投石索等，轻中机枪归为步枪，重机枪归为低级机炮，导弹归为火炮，普通施法归为法杖，分清楚weapon和skill');
  expect(text).not.toContain('(战况结算只能由系统完成，绝对禁止描写完战况后变更)');
  expect(text).not.toContain('禁止用于战况结算，只用于战场外修改!');
});
