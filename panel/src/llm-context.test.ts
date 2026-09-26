import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateUnit } from '../../engine/src/index.js';
import { LlmContextController } from './llm-context.js';
import type { LlmSettings } from './llm-settings.js';
const settings: LlmSettings = {enabled:true,windowSize:2,url:'https://gateway.example/v1',token:'test-key',model:'chosen-model',models:['chosen-model']};
const input = () => ({
  roster: (['ally','enemy'] as const).map(side => generateUnit({name:side,side,scale:'company',hpMax:20,level:3,traits:[],rulesVersion:'v2'},{seed:side}).unit),
  setup: {mode:'mass' as const,field:'plains',lighting:'day' as const,mapLayout:'standard' as const,objectiveMode:'auto' as const,siegeAttacker:'ally' as const},
  messages: [
    {id:'old',role:'assistant',text:'旧剧情',completed:true},
    {id:'user',role:'user',text:'我们护送目标进入建筑，指挥官谨慎。',completed:true},
    {id:'sys',role:'system',text:'不得发送',completed:true},
    {id:'new',role:'assistant',text:'<think>隐藏推理</think>夜间室内护送，敌将是专家，喜用集中火力。',completed:true},
    {id:'stream',role:'assistant',text:'未完成',completed:false},
  ],
});
function model(values: Record<string,string> = {}, confidence = .95) {
  return vi.fn<typeof fetch>(async (_url,init) => {
    const payload=JSON.parse(String(init?.body)), body=JSON.parse(payload.messages[1].content);
    return new Response(JSON.stringify({model:'response-alias',choices:[{message:{content:JSON.stringify({selections:Object.fromEntries(body.fields.map((f:{id:string})=>[f.id,{value:values[f.id]??'unknown',confidence}]))})}}]}));
  });
}
afterEach(()=>vi.unstubAllGlobals());
describe('ordinary LLM preparation',()=>{
  it('reads the requested completed user/assistant layers and applies both commanders and supported scene constraints',async()=>{
    const request=model({ally_ability:'regular',ally_style:'cautious',enemy_ability:'expert',enemy_style:'firepower',field:'urban',lighting:'night',map_layout:'indoor',objective:'escort',battle_mode:'mass'});
    const source=input(),before=JSON.stringify(source);
    const result=await new LlmContextController(request).select(source,settings,()=>true);
    expect(result).toMatchObject({mode:'small',field:'urban',lighting:'night',mapLayout:'indoor',objectiveMode:'escort',commanders:{ally:{ability:'regular',style:'cautious'},enemy:{ability:'expert',style:'firepower'}}});
    const payload=JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(payload.model).toBe('chosen-model');
    expect(JSON.parse(payload.messages[1].content).messages.map((m:{id:string})=>m.id)).toEqual(['user','new']);
    expect(payload.messages[1].content).not.toMatch(/隐藏推理|未完成|不得发送|旧剧情/);
    expect(request.mock.calls[0]![0]).toBe('https://gateway.example/v1/chat/completions');
    expect(JSON.stringify(source)).toBe(before);
    expect(settings.model).toBe('chosen-model');
  });
  it('retains defaults for weak evidence and uses no request for an empty completed window',async()=>{
    const request=model({lighting:'night',enemy_ability:'master',enemy_style:'aggressive'},.1),c=new LlmContextController(request);
    expect(await c.select(input(),settings,()=>true)).toMatchObject({lighting:'day',commanders:{}});
    request.mockClear();
    expect((await c.select({...input(),messages:[]},settings,()=>true)).detail).toContain('沿用');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects invented or incomplete choices without applying a partial result',async()=>{
    await expect(new LlmContextController(model({field:'space'})).select(input(),settings,()=>true)).rejects.toThrow('尚未开战');
    const request:typeof fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"selections":{}}'}}]}));
    await expect(new LlmContextController(request).select(input(),settings,()=>true)).rejects.toThrow('尚未开战');
  });
  it.each(['cancel','switch'] as const)('discards a late answer after %s even when fetch ignores abort',async how=>{
    let release!:()=>void, started!:()=>void,valid=true;
    const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r),answer=model({field:'forest'});
    const c=new LlmContextController(async(...args)=>{started();await gate;return answer(...args);});
    const pending=c.select(input(),settings,()=>valid);await ready;
    if(how==='cancel')c.cancel();else valid=false;
    release();await expect(pending).rejects.toThrow('尚未开始战斗');expect(c.busy).toBe(false);
  });
});
