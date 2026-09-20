import { afterEach, expect, it, vi } from 'vitest';
import { encodeSave, decodeSave } from './storage-codec.js';
import { createAdapter } from './tavern.js';
afterEach(()=>vi.unstubAllGlobals());

it('大存档含中文、表情、重复报告和宽字符无损压缩，兼容旧JSON',()=>{
  const text=JSON.stringify({reports:Array.from({length:1500},(_,i)=>({id:i,name:'编队⚔️😀',log:'命中但未造成减员，保留当前伤势与来源。'.repeat(12)})),unicode:Array.from({length:65536},(_,i)=>String.fromCharCode(i)).join('')});
  const packed=encodeSave(text);expect(packed.length).toBeLessThan(text.length*.4);expect(decodeSave(packed)).toBe(text);
  expect(decodeSave('{"hp":17}')).toBe('{"hp":17}');
});
it('容量满时原子压缩本插件旧镜像，并重新读取最新存档；不清除其他数据',()=>{
  const oldKey='tavern-battle:chat:chat:old:panel',key='tavern-battle:chat:chat:test:panel';
  const old=JSON.stringify({reports:['历史战报完整保留'.repeat(30000)]}),values=new Map([[oldKey,old],['unrelated','其他应用数据']]);
  const limit=old.length+500;
  vi.stubGlobal('window',{SillyTavern:{getContext:()=>({chatId:'test'})}});
  vi.stubGlobal('localStorage',{get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{
    const size=[...values].reduce((n,[id,text])=>n+(id===k?0:text.length),0)+v.length;
    if(size>limit)throw new DOMException('quota','QuotaExceededError');values.set(k,v);
  }});
  const adapter=createAdapter(),payload={reports:['新战报'.repeat(25000)],hp:17};
  expect(adapter.save('panel',payload).status).toBe('saved');expect(adapter.load('panel')).toMatchObject(payload);
  expect(decodeSave(values.get(oldKey)!)).toBe(old);expect(values.get('unrelated')).toBe('其他应用数据');expect(values.has(key)).toBe(true);
});
it('宿主异步API已同步更新变量时允许确认，本地拒写也不误报失败',()=>{
  const values:Record<string,unknown>={};
  vi.stubGlobal('window',{TavernHelper:{getVariables:()=>values,insertOrAssignVariables:async (next:Record<string,unknown>)=>{Object.assign(values,next);}},SillyTavern:{getContext:()=>({chatId:'test'})}});
  vi.stubGlobal('localStorage',{length:0,getItem:()=>null,setItem:()=>{throw new DOMException('quota','QuotaExceededError');}});
  expect(createAdapter().save('panel',{hp:17})).toMatchObject({status:'saved',host:true,local:false});
});
