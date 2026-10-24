import { afterEach, expect, it, vi } from 'vitest';
import { createWorldbookSource } from '../../host/src/worldbooks.js';
import { selectedWorldbookMessages, setLlmWorldbookSource, normalizeWorldbookSelection } from './llm-worldbooks.js';
import { openAiJsonRequest, openAiCommandRequest, openAiTextRequest } from './jev-connection.js';
import { llmConnection, llmConnectionKey, type LlmSettings } from './llm-settings.js';
import { WorldbookReadError } from '../../host/src/worldbook-error.js';

afterEach(()=>setLlmWorldbookSource(undefined));
it('reads the host catalog and entry IDs without storing or altering other host settings',async()=>{
  const request=vi.fn(async(url,init)=>{
    expect(init?.method).toBe('POST');expect((init?.headers as any)['X-CSRF']).toBe('fixture');
    return new Response(JSON.stringify(String(url).endsWith('/get')&&String(url).includes('worldinfo')
      ? {entries:{'4':{uid:4,comment:'标题',content:'正文'},'9':{key:['别名'],content:'其他'}}}
      : {world_names:['设定','设定'],secret:'unrelated'}));
  }) as unknown as typeof fetch;
  const source=createWorldbookSource(()=>({getRequestHeaders:()=>({'X-CSRF':'fixture'})}),request);
  expect(await source.list()).toEqual(['设定']);
  expect(await source.read('设定')).toEqual([{id:'4',title:'标题',content:'正文'},{id:'9',title:'别名',content:'其他'}]);
  expect(JSON.parse(String((request as any).mock.calls[1][1].body))).toEqual({name:'设定'});
});
it('sends only selected entries to JSON, tool and text calls, once after the first user message',async()=>{
  const source={list:async()=>['设定'],read:vi.fn(async()=>[{id:'4',title:'标题',content:'当前正文'},{id:'9',title:'未选',content:'不发送'}])};
  setLlmWorldbookSource(source);
  const settings:LlmSettings={enabled:true,selectBattleScale:false,windowSize:6,url:'https://example.invalid/v1',token:'',model:'fixture',models:[],worldbooks:[{name:'设定',entries:['4']}]};
  const connection=llmConnection(settings),signal=new AbortController().signal;
  const messages=[{role:'system' as const,content:'系统'},{role:'user' as const,content:'原消息'},{role:'user' as const,content:'任务'}];
  const bodies:any[]=[];
  const request=(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:'{"choice":"end"}'}}]}));}) as typeof fetch;
  await openAiJsonRequest(connection,messages,signal,request);
  await openAiCommandRequest(connection,messages,[],signal,request,{reasoning_effort:'high',vendor_strength:7});
  await openAiTextRequest(connection,messages,signal,request);
  for(const body of bodies){expect(body.messages.slice(0,2)).toEqual(messages.slice(0,2));expect(body.messages[3]).toEqual(messages[2]);expect(JSON.parse(body.messages[2].content)).toEqual({worldbooks:[{name:'设定',entries:[{id:'4',title:'标题',content:'当前正文'}]}]});}
  expect(bodies[1]).toMatchObject({reasoning_effort:'high',vendor_strength:7});
  expect(messages).toHaveLength(3);
});
it('keeps selections independent, sends nothing by default, and surfaces a missing selected entry',async()=>{
  expect(normalizeWorldbookSelection([{name:'甲',entries:['1','1']},{name:'乙',entries:'all'},{name:'甲',entries:'all'},{name:'丙',entries:[]}])).toEqual([{name:'甲',entries:['1']},{name:'乙',entries:'all'}]);
  expect(await selectedWorldbookMessages([],new AbortController().signal)).toEqual([]);
  setLlmWorldbookSource({list:async()=>[],read:async()=>[]});
  await expect(selectedWorldbookMessages([{name:'甲',entries:['deleted']}],new AbortController().signal)).rejects.toThrow('重新选择');
});

it('uses the current character activation for every request type, without mixing preserved manual selections',async()=>{
  const source={list:vi.fn(),read:vi.fn(),active:vi.fn(async()=>[{name:'角色世界',entries:[{id:'7',title:'绿灯命中',content:'本轮内容'}]}])};
  setLlmWorldbookSource(source);
  const settings:LlmSettings={enabled:true,selectBattleScale:false,windowSize:6,url:'https://example.invalid/v1',token:'',model:'fixture',models:[],
    worldbookMode:'character',worldbooks:[{name:'不发送的手动书',entries:'all'}]};
  const connection=llmConnection(settings),signal=new AbortController().signal;
  const messages=[{role:'system' as const,content:'系统'},{role:'user' as const,content:'原消息'},{role:'user' as const,content:'任务'}];
  const bodies:any[]=[];
  const request=(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:'{"choice":"end"}'}}]}));}) as typeof fetch;
  await openAiJsonRequest(connection,messages,signal,request);
  await openAiCommandRequest(connection,messages,[],signal,request);
  await openAiTextRequest(connection,messages,signal,request);
  expect(source.active).toHaveBeenCalledTimes(3);expect(source.read).not.toHaveBeenCalled();expect(source.list).not.toHaveBeenCalled();
  for(const body of bodies){expect(body.messages.slice(0,2)).toEqual(messages.slice(0,2));expect(JSON.parse(body.messages[2].content)).toEqual({worldbooks:[{name:'角色世界',entries:[{id:'7',title:'绿灯命中',content:'本轮内容'}]}]});expect(JSON.stringify(body)).not.toContain('不发送的手动书');}
  expect(llmConnectionKey(settings)).not.toBe(llmConnectionKey({...settings,worldbookMode:'manual'}));
  source.active.mockResolvedValue([]);
  await openAiTextRequest(connection,messages,signal,request);
  expect(bodies.at(-1).messages).toEqual(messages);
  source.active.mockRejectedValue(new WorldbookReadError('activation-missing'));
  await expect(openAiTextRequest(connection,messages,signal,request)).rejects.toThrow('生成一次正文');
  expect(bodies).toHaveLength(4);
});

it('preserves host iframe worldbook error codes and never echoes an unknown read failure or sends a model request',async()=>{
  const settings:LlmSettings={enabled:true,selectBattleScale:false,windowSize:2,url:'https://example.invalid/v1',token:'private-fixture-key',model:'fixture',models:[],worldbookMode:'character'};
  const request=vi.fn(),signal=new AbortController().signal;
  setLlmWorldbookSource({list:vi.fn(),read:vi.fn(),active:async()=>{throw {name:'WorldbookReadError',code:'activation-missing',message:'private-fixture-key'};}});
  await expect(openAiJsonRequest(llmConnection(settings),[],signal,request)).rejects.toThrow('生成一次正文');
  setLlmWorldbookSource({list:vi.fn(),read:vi.fn(),active:async()=>{throw Error('private-fixture-key');}});
  const error=await openAiJsonRequest(llmConnection(settings),[],signal,request).catch(error=>error as Error);
  expect(error.message).toContain('世界书激活结果失败');expect(error.message).not.toContain('private-fixture-key');
  expect(request).not.toHaveBeenCalled();
});
