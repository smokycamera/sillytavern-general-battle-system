import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLlmSettings,saveLlmSettings,llmConnection,LLM_SETTINGS_KEY,llmSettingsView } from './llm-settings.js';
import { renderLlmSettings } from './llm-settings-view.js';
afterEach(()=>vi.unstubAllGlobals());
function storage(){const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});vi.stubGlobal('sessionStorage',{getItem:()=>null});return data;}
describe('global ordinary LLM settings',()=>{
  it('round trips credentials and model list without using a chat/card key or legacy route',()=>{
    const data=storage(),s={...readLlmSettings(),url:'https://gateway.example/v1',token:'test-key',model:'chosen',models:['chosen','other'],enabled:true,selectBattleScale:false,windowSize:18};
    saveLlmSettings(s);expect(readLlmSettings()).toEqual(s);expect([...data.keys()]).toEqual([LLM_SETTINGS_KEY]);
    expect(llmConnection(s)).toEqual({url:s.url,token:s.token,model:s.model,protocol:'openai',transport:'auto'});
    const html=renderLlmSettings(s);expect(html).toContain('<option value="jev" disabled>jev指挥功能(未完成，勿选)</option>');expect(html).not.toMatch(/data-role="jev-|转发地址|连接途径/);
  });
  it('preserves previous scale selection by default and disables the control outside LLM mode',()=>{
    const data=storage();
    expect(readLlmSettings().selectBattleScale).toBe(true);
    data.set(LLM_SETTINGS_KEY,JSON.stringify({enabled:true,model:'previous-model'}));
    const settings=readLlmSettings();
    expect(settings).toMatchObject({selectBattleScale:true,model:'previous-model'});
    expect(renderLlmSettings(settings)).toMatch(/data-role="llm-battle-scale"[^>]*checked/);
    expect(renderLlmSettings({...settings,enabled:false})).toMatch(/data-role="llm-battle-scale"[^>]*disabled/);
  });
  it('migrates a legacy OpenAI connection once while retaining the original and ignoring a stale relay',()=>{
    const data=storage();for(const[k,v]of Object.entries({protocol:'openai',url:'https://gateway.example/v1',token:'old-key',model:'old-model','relay-url':'http://127.0.0.1:4318'}))data.set('tb:jev:'+k,v);
    expect(readLlmSettings()).toMatchObject({token:'old-key',model:'old-model',models:['old-model'],enabled:false});
    data.set('tb:jev:token','stale');expect(readLlmSettings().token).toBe('old-key');expect(data.has('tb:jev:url')).toBe(true);
  });
  it('does not silently overwrite corrupted settings or reinterpret TypeSafe as OpenAI',()=>{
    const data=storage();data.set('tb:jev:protocol','typesafe');expect(readLlmSettings().url).toBe('');
    data.set(LLM_SETTINGS_KEY,'broken');expect(()=>readLlmSettings()).toThrow('原记录已保留');expect(data.get(LLM_SETTINGS_KEY)).toBe('broken');
  });
  it('renders a readable error for damaged or blocked storage while actions stay strict',()=>{
    const data=storage();data.set(LLM_SETTINGS_KEY,'broken');
    const view=llmSettingsView();expect(view.error).toContain('原记录已保留');
    expect(()=>renderLlmSettings(view.settings,view.error)).not.toThrow();
    expect(data.get(LLM_SETTINGS_KEY)).toBe('broken');expect(()=>readLlmSettings()).toThrow();
    vi.stubGlobal('localStorage',{getItem(){throw new DOMException('blocked','SecurityError');}});
    expect(llmSettingsView().error).toContain('存储权限');expect(()=>readLlmSettings()).toThrow('原配置未修改');
  });
  it('keeps the saved credentials when a quota error prevents replacing settings',()=>{
    const data=storage(),saved={...readLlmSettings(),token:'original-key',model:'original'};saveLlmSettings(saved);
    vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem(){throw new DOMException('full','QuotaExceededError');}});
    expect(()=>saveLlmSettings({...saved,token:'new-key'})).toThrow('未保存');
    expect(readLlmSettings()).toEqual(saved);
  });
});
