import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridgeServer } from './server.mjs';

const root = path.resolve('release/native-candidate');
const seed = JSON.parse(readFileSync('artifacts/mcp-smoke/fixture.json', 'utf8'));
const disk = new Map(), errors = [], checks = [];
const fixture = `<!doctype html><html><body><main id="chat"></main><textarea id="send_textarea">玩家草稿</textarea><script>
const handlers=new Map();
window.context={characterId:'0',characters:[{avatar:'fixture.png',name:'MCP fixture'}],chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},
eventTypes:Object.fromEntries(['CHAT_CHANGED','MESSAGE_SENT','GENERATION_ENDED','MESSAGE_RECEIVED'].map(k=>[k,k])),
eventSource:{on(k,fn){const s=handlers.get(k)||new Set();s.add(fn);handlers.set(k,s)},removeListener(k,fn){handlers.get(k)?.delete(fn)},async emit(k,...args){for(const fn of handlers.get(k)||[])await fn(...args)}},
getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){},setExtensionPrompt(){},
async saveMetadata(){await fetch('/fixture/save',{method:'POST',body:JSON.stringify({id:context.chatId,metadata:context.chatMetadata,chat:context.chat})})},async saveChat(){await this.saveMetadata()}};
window.SillyTavern={getContext:()=>context};window.__TAURITAVERN__={};
import('/extension/index.js');</script></body></html>`;
const host = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(fixture); }
    if (req.url === '/api/users/me') return res.end(JSON.stringify({ handle: 'mcp-smoke' }));
    if (req.url === '/scripts/user.js') { res.setHeader('Content-Type','text/javascript'); return res.end('export const accountsEnabled=false; export const getCurrentUserHandle=()=>"mcp-smoke";'); }
    if (req.method === 'POST') {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/fixture/save') { disk.set(data.id, data); return res.end('{}'); }
      if (req.url === '/api/chats/get') { const save=disk.get(data.file_name); return res.end(JSON.stringify([{chat_metadata:save?.metadata??{}},...(save?.chat??[])])); }
    }
    const file=path.resolve(root,decodeURIComponent(new URL(req.url,'http://fixture').pathname).replace(/^\/extension\//,''));
    if (!file.startsWith(root+path.sep)) throw Error('Outside fixture');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'); res.end(readFileSync(file));
  } catch(e) { res.statusCode=404; res.end(e.message); }
});
await new Promise(r=>host.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${host.address().port}`;
const token='browser-smoke-only-credential-not-a-real-user-secret';
const bridge=createBridgeServer({token,origins:[url]});
await new Promise(r=>bridge.http.listen(0,'127.0.0.1',r));
const bridgeUrl=`http://127.0.0.1:${bridge.http.address().port}`;
const executablePath=process.env.TB_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
const client=new Client({name:'browser-smoke',version:'1'});
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
try {
  await page.goto(url); await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='ready');
  await page.evaluate(saved=>window.__tavernBattleNative.service.transact(()=>saved), seed.battle);
  await page.locator('#tavern-battle-native-entry').click();
  const frame=page.frameLocator('#tavern-battle-native-panel iframe'); await frame.locator('#app h1').waitFor();
  await frame.locator('[data-action="workspace-tab"][data-tab="settings"]').click();
  check('default disconnected',bridge.broker.list().length===0);
  await frame.locator('[data-mcp-url]').fill(bridgeUrl); await frame.locator('[data-mcp-token]').fill(token); await frame.locator('[data-mcp-connect]').click();
  await frame.locator('[data-mcp-status]').filter({hasText:'已连接'}).waitFor();
  await client.connect(new StreamableHTTPClientTransport(new URL(bridgeUrl+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const sessions=await client.callTool({name:'battle_sessions',arguments:{}}); const sessionId=sessions.structuredContent.sessions[0].sessionId;
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:{sessionId,...args}});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
  const observe=()=>call('battle_observe',{limit:500});
  const click=async predicate=>{const view=await observe(),control=view.controls.find(predicate);assert.ok(control,JSON.stringify(view.controls.map(c=>({label:c.label,action:c.action,tab:c.tab}))));return call('battle_click',{viewId:view.viewId,controlId:control.controlId});};
  check('protocol advertises sixteen tools',(await client.listTools()).tools.length===16);
  const settings=await observe(); check('pairing secret never serialized',!JSON.stringify(settings).includes(token));
  await click(c=>c.action==='workspace-tab'&&c.tab==='battle');
  const view=await observe();check('hidden enemy absent',!JSON.stringify(view).includes('MCP 隐藏敌军'));
  await click(c=>c.action==='grid-endturn');
  check('real turn persisted',await page.evaluate(()=>__tavernBattleNative.service.snapshot().battle.snap.round===2));
  await click(c=>c.action==='workspace-tab'&&c.tab==='units');
  await click(c=>c.action==='workspace-tab'&&c.tab==='inventory');
  check('inventory editing retains battle restrictions',(await observe()).controls.find(c=>c.action==='inventory-new')?.disabled);
  await click(c=>c.action==='workspace-tab'&&c.tab==='battle');
  const stale=await observe(),nav=stale.controls.find(c=>c.action==='workspace-tab');
  await page.evaluate(async saved=>{context.chatId='b';context.chat=[];context.chatMetadata={};await __tavernBattleNative.service.load();await __tavernBattleNative.service.transact(()=>saved);},seed.ready);
  const rejected=await client.callTool({name:'battle_click',arguments:{sessionId,viewId:stale.viewId,controlId:nav.controlId}});
  check('old chat command rejected',rejected.isError);
  await click(c=>c.action==='workspace-tab'&&c.tab==='inventory');
  await click(c=>c.action==='inventory-new');
  let current=await observe(),name=current.controls.find(c=>c.role==='inventory-name');assert.ok(name);
  await call('battle_fill',{viewId:current.viewId,controlId:name.controlId,value:'MCP 测试物品'});
  await click(c=>c.action==='inventory-close-draft');
  check('inventory draft controlled through UI',true);
  await click(c=>c.action==='workspace-tab'&&c.tab==='battle');
  const help=await call('battle_help');check('map and command rules available',help.rules.commanderStyles.includes('flanking')&&help.rules.battlefield.includes('bridgePlan'));
  current=await observe();
  await call('battle_prepare',{viewId:current.viewId,commanders:{ally:{ability:'master',style:'flanking'},enemy:{ability:'regular',style:'cautious'}},battlefield:{scene:'field',layout:'lanes',landmarks:[{kind:'hill',anchor:'center_left',label:'MCP 西侧高地'}]}});
  await click(c=>c.action==='small-start');
  check('prepared battle uses real commander/map pipeline',await page.evaluate(()=>{const s=__tavernBattleNative.service.snapshot();return s.battle.snap.commanderProfiles.ally.style==='flanking'&&s.encounterContext.battlefieldPlan.landmarks[0].label==='MCP 西侧高地'}));
  await click(c=>c.label==='存档管理');
  check('native management controls exposed',(await observe()).controls.some(c=>c.label==='导出完整原生存档'));
  const downloaded=page.waitForEvent('download');
  await click(c=>c.label==='导出完整原生存档');
  const exported=readFileSync(await (await downloaded).path(),'utf8');
  check('export goes to browser file',JSON.parse(exported).format==='tavern-battle-export');
  await click(c=>c.label==='导入存档文件');
  current=await observe();const file=current.controls.find(c=>c.type==='file');assert.ok(file);
  await call('battle_upload',{viewId:current.viewId,controlId:file.controlId,filename:'mcp-roundtrip.json',content:exported});
  check('file upload presents native preview',(await observe()).controls.some(c=>c.label.startsWith('确认导入')));
  await click(c=>c.label==='取消');
  await click(c=>c.label==='返回面板');
  await click(c=>c.action==='workspace-tab'&&c.tab==='settings');
  await page.screenshot({path:'artifacts/mcp-smoke/connected.png',fullPage:true});
  await frame.locator('[data-mcp-disconnect]').click();
  await page.waitForTimeout(150);
  check('disconnect removes session',bridge.broker.list().length===0);
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').click();
  check('manual navigation still works',await frame.locator('[data-workspace="battle"]').isVisible());
  check('no browser exceptions',errors.length===0);
  writeFileSync('artifacts/mcp-smoke/results.json',JSON.stringify({checks,errors},null,2));
} catch (error) {
  console.error(JSON.stringify({ browserErrors: errors, body: await page.locator('body').textContent(), runtime: await page.evaluate(()=>{const status=window.__tavernBattleNative?.service.status();return {phase:status?.phase,error:status?.error};}) }, null, 2));
  await page.screenshot({path:'artifacts/mcp-smoke/failure.png',fullPage:true});
  throw error;
} finally {
  await client.close();await browser.close();bridge.broker.close();bridge.http.closeAllConnections();host.closeAllConnections();
  await Promise.all([new Promise(r=>bridge.http.close(r)),new Promise(r=>host.close(r))]);
}
