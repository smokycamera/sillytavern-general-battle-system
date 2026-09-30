import {describe,it,expect} from 'vitest';
import {selectSpatialNarrative,narrativeMapSources} from './narrative-map-source.js';
import {validateSceneIntentEvidence} from '../../engine/src/small/scene-intent.js';
describe('map narrative evidence',()=>{
  it('retains early geography and latest changes within the existing message budget',()=>{
    const text='城市在西侧，东门外只有一座桥。\n\n'+Array.from({length:10},()=> '普通对话'.repeat(190)).join('\n\n')+'\n\n守军已经退到北侧高地。';
    const selected=selectSpatialNarrative(text);expect(selected.length).toBeLessThanOrEqual(6000);expect(selected).toContain('东门外只有一座桥');expect(selected).toContain('已经退到北侧高地');
  });
  it('gives each sent paragraph a stable reference and rejects sources never sent',()=>{
    const source=narrativeMapSources([{id:'message',role:'assistant',completed:true,text:'河在城东。\n\n敌军在桥头。'}]);
    expect(source.messages[0]!.text).toContain('[m1.p2]');
    const intent={schema:'scene-intent-v1' as const,entities:[{id:'river',kind:'river' as const,basis:'explicit' as const,sources:['m1.p3']}],relations:[],constraints:[]};
    expect(()=>validateSceneIntentEvidence(intent,source.sources,[])).toThrow('未发送');
  });
});
