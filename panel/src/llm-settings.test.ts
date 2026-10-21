import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLlmSettings,saveLlmSettings,llmConnection,LLM_SETTINGS_KEY,llmSettingsView,commandRequestOptions,parseCommandParameters } from './llm-settings.js';
import { renderLlmSettings } from './llm-settings-view.js';
afterEach(()=>vi.unstubAllGlobals());
function storage(){const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});vi.stubGlobal('sessionStorage',{getItem:()=>null});return data;}
describe('global ordinary LLM settings',()=>{
  it('leaves vendor thinking untouched by default and saves editable nonthinking parameters',()=>{
    storage(); const settings=readLlmSettings();
    expect(settings).toMatchObject({commandInterval:'round',commandThinking:'auto'});
    expect(commandRequestOptions(settings)).toEqual({});
    expect(renderLlmSettings(settings)).not.toContain('llm-command-params"');
    expect(commandRequestOptions({...settings,commandThinking:'off'})).toEqual({thinking:{type:'disabled'}});
    saveLlmSettings({...settings,commandThinking:'off',commandThinkingOffParams:'{"reasoning_effort":"none"}'});
    const loaded=readLlmSettings();
    expect(commandRequestOptions(loaded)).toEqual({reasoning_effort:'none'});
    expect(commandRequestOptions({...loaded,commandThinking:'auto'})).toEqual({});
    expect(commandRequestOptions({...loaded,commandThinkingOffParams:'{}'})).toEqual({});
    const vendor={thinking:{type:'disabled'},reasoning_effort:'high',vendor_strength:7};
    expect(commandRequestOptions({...loaded,commandThinkingOffParams:JSON.stringify(vendor)})).toEqual(vendor);
    expect(renderLlmSettings(loaded)).toContain('<details><summary>高级兼容设置</summary>');
    for(const text of ['broken','null','[]','{"messages":[]}','{"model":"other"}','{"stream":true}','{"tools":[]}']) expect(()=>parseCommandParameters(text)).toThrow();
  });
  it('persists cadence independently of two thinking modes and migrates the removed round thinking option',()=>{
    const data=storage(),settings={...readLlmSettings(),commandInterval:'situation' as const,commandThinking:'off' as const,commandThinkingOffParams:'{"enable_thinking":false,"vendor":{"effort":"low"}}'};
    saveLlmSettings(settings);expect(readLlmSettings()).toEqual(settings);
    expect(commandRequestOptions(settings)).toEqual({enable_thinking:false,vendor:{effort:'low'}});
    const html=renderLlmSettings(settings);
    expect(html.indexOf('data-role="llm-command-interval"')).toBeLessThan(html.indexOf('data-role="llm-command-thinking"'));
    expect(html).toContain('每回合（推荐，调用次数少）');expect(html).not.toContain('每回合思考一次');
    expect(html.match(/data-role="llm-command-thinking"[^>]*>(.*?)<\/select>/s)![1]!.match(/<option /g)).toHaveLength(2);
    expect(html).not.toContain('llm-command-effort');expect(html).toContain('附加参数');expect(html).toContain('llm-command-params-reset');
    data.set(LLM_SETTINGS_KEY,JSON.stringify({...settings,commandThinking:'round'}));
    expect(readLlmSettings()).toMatchObject({commandInterval:'situation',commandThinking:'auto',commandThinkingOffParams:settings.commandThinkingOffParams});
  });
  it('accepts generic assignments without rewriting names and preserves unfinished drafts independently',()=>{
    storage();const settings={...readLlmSettings(),commandThinking:'off' as const,commandThinkingOffParams:'reasoning_effort="low"\nenable_thinking=false\nvendor={"budget":64}'};
    expect(commandRequestOptions(settings)).toEqual({reasoning_effort:'low',enable_thinking:false,vendor:{budget:64}});
    expect(parseCommandParameters('reaoning_effort="low"')).toEqual({reaoning_effort:'low'});
    expect(parseCommandParameters('vendor_strength=high')).toEqual({vendor_strength:'high'});
    for(const invalid of ['reasoning_effort="lo','thinking={','model=other','messages=[]','same=1\nsame=2']) expect(()=>parseCommandParameters(invalid)).toThrow();
    saveLlmSettings({...settings,commandThinkingOffDraft:'reasoning_effort="lo'});
    expect(renderLlmSettings(readLlmSettings())).toContain('reasoning_effort=&quot;lo');
    expect(commandRequestOptions(readLlmSettings())).toEqual({reasoning_effort:'low',enable_thinking:false,vendor:{budget:64}});
  });
  it('round trips credentials and model list without using a chat/card key or legacy route',()=>{
    const data=storage(),s={...readLlmSettings(),url:'https://gateway.example/v1',token:'test-key',model:'chosen',models:['chosen','other'],enabled:true,selectBattleScale:false,windowSize:18};
    saveLlmSettings(s);expect(readLlmSettings()).toEqual(s);expect([...data.keys()]).toEqual([LLM_SETTINGS_KEY]);
    expect(llmConnection(s)).toEqual({url:s.url,token:s.token,model:s.model,protocol:'openai',transport:'auto'});
    const html=renderLlmSettings(s);expect(html).toContain('<option value="jev" disabled>JEV 指挥（暂不可用）</option>');expect(html).not.toMatch(/data-role="jev-|转发地址|连接途径/);
  });
  it('hides scale selection, ignores the old scale preference and defaults enemy command off',()=>{
    const data=storage();
    expect(readLlmSettings().selectBattleScale).toBe(false);
    data.set(LLM_SETTINGS_KEY,JSON.stringify({enabled:true,model:'previous-model',selectBattleScale:true}));
    const settings=readLlmSettings();
    expect(settings).toMatchObject({selectBattleScale:false,commandEnemy:false,model:'previous-model'});
    expect(renderLlmSettings(settings)).not.toContain('llm-battle-scale');
    expect(renderLlmSettings({...settings,enabled:false})).toMatch(/data-role="llm-enemy-command"[^>]*disabled/);
    saveLlmSettings({...settings,commandEnemy:true});expect(readLlmSettings().commandEnemy).toBe(true);
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
  it('map design and VIP default on, are persisted independently, and remain strictly boolean',()=>{
    const data=storage();
    expect(readLlmSettings()).toMatchObject({designMap:true,selectVip:true,selectBattleScale:false});
    for(const designMap of [true,false])for(const selectVip of [true,false]){
      const settings={...readLlmSettings(),enabled:true,designMap,selectVip};saveLlmSettings(settings);
      expect(readLlmSettings()).toEqual(settings);
      const html=renderLlmSettings(settings);
      expect(/data-role="llm-map-design"[^>]*checked/.test(html)).toBe(designMap);
      expect(/data-role="llm-vip"[^>]*checked/.test(html)).toBe(selectVip);
      expect(renderLlmSettings({...settings,enabled:false})).toMatch(/data-role="llm-vip"[^>]*disabled/);
    }
    data.set(LLM_SETTINGS_KEY,JSON.stringify({designMap:'true',selectVip:1}));
    expect(readLlmSettings()).toMatchObject({designMap:false,selectVip:false});
  });

});
