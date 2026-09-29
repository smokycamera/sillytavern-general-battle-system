import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('release/native-candidate');
const metadataMode = process.env.TB_METADATA_MODE ?? 'metadata-only';
assert.ok(['metadata-only', 'legacy-full'].includes(metadataMode), 'Unknown metadata save mode');
const artifacts = path.resolve('artifacts/layered-browser', metadataMode); mkdirSync(artifacts, { recursive: true });
const disk = new Map(); const results = []; const errors = [];
let jevDelay = 0; let jevRequests = 0;
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><textarea id="send_textarea">未发送的玩家草稿 | /send {{macro}}</textarea><input id="pending-file" value="fixture-attachment.txt"><main id="chat"></main><script>
window.handlers = new Map(); window.__failure=false; window.__delay=0; window.__generations=0; window.__prompts={};window.__metadataSaves=0;window.__fullSaves=0;
window.persistFixture=async full=>{const snapshot={id:context.chatId,metadata:structuredClone(context.chatMetadata),...(full?{chat:structuredClone(context.chat)}:{})};if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));if(!window.__failure){const response=await fetch(full?'/fixture/save':'/fixture/metadata',{method:'POST',body:JSON.stringify(snapshot)});if(!response.ok)throw Error('Fixture save failed: '+response.status)}};
window.context={ characterId:'0', characters:[{avatar:'fixture.png',name:'Fixture'}],chatId:'a',name1:'Tester',chat:[],chatMetadata:{},extensionSettings:{},
eventTypes:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SENT','USER_MESSAGE_RENDERED','CHAT_CHANGED'].map(x=>[x,x])),
eventSource:{on(k,cb){const a=handlers.get(k)||new Set();a.add(cb);handlers.set(k,a)},removeListener(k,cb){handlers.get(k)?.delete(cb)},async emit(k,...args){for(const cb of handlers.get(k)||[])await cb(...args)}},
getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){},
async saveMetadata(){window.__metadataSaves++;await persistFixture(${metadataMode === 'legacy-full'})},
async saveChat(){window.__fullSaves++;await persistFixture(true)},
setExtensionPrompt(id,value){__prompts[id]=value},addOneMessage(message){const p=document.createElement('p');p.textContent=message.mes;document.getElementById('chat').append(p)},async generate(type,options){window.__generations++;window.__generationType=type;if(type==='normal'){document.getElementById('send_textarea').value='';document.getElementById('pending-file').value=''}await context.eventSource.emit('GENERATION_STARTED',type,options,false);await context.eventSource.emit('GENERATION_AFTER_COMMANDS',type,options,false);context.chat.push({is_user:false,mes:'合成宿主的完整叙述回复',swipe_id:0,gen_finished:'complete'});await context.saveChat();await context.eventSource.emit('MESSAGE_RECEIVED',context.chat.length-1);await context.eventSource.emit('GENERATION_ENDED',context.chat.length-1)}};
window.SillyTavern={getContext:()=>context};
window.switchChat=async id=>{const response=await fetch('/api/chats/get',{method:'POST',body:JSON.stringify({file_name:id})});const data=await response.json();context.chatId=id;context.chatMetadata=data[0]?.chat_metadata||{};context.chat=data.slice(1);await context.eventSource.emit('CHAT_CHANGED')};
awaitReady();async function awaitReady(){await switchChat('a');await import('/extension/index.js');}
</script></body></html>`;
const server = http.createServer(async (req,res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return; }
    if (req.url === '/api/users/me') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({handle:'smoke-user'}));return; }
    if (req.method === 'POST') {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type','application/json');
      if(req.url==='/jev/api/bridge/evaluate') { jevRequests++; if(jevDelay) await new Promise(resolve=>setTimeout(resolve,jevDelay));res.end(JSON.stringify({model:'browser-test-jev',confidence:0.9,scores:Object.fromEntries(data.candidates.map(c=>[c.id,0.5]))}));return; }
      if(req.url==='/jev/api/bridge/select-context') {res.end(JSON.stringify({model:'browser-test-jev',selections:Object.fromEntries(data.fields.map(f=>[f.id,{value:Object.keys(f.options)[0],confidence:0}]))}));return;}
      if(req.url==='/jev/api/bridge/context') {res.end(JSON.stringify({goals:[],battleType:'skirmish'}));return;}
      if(req.url==='/fixture/save'){disk.set(data.id,structuredClone(data));res.end('{}');return;}
      if(req.url==='/fixture/metadata'){disk.set(data.id,{...(disk.get(data.id)??{chat:[]}),id:data.id,metadata:structuredClone(data.metadata)});res.end('{}');return;}
      if(req.url==='/api/chats/get'){const state=disk.get(data.file_name);res.end(JSON.stringify([{chat_metadata:state?.metadata??{}},...(state?.chat??[])]));return;}
    }
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/extension\//,'');
    const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))throw Error('Outside fixture');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(file));
  }catch(error){res.statusCode=404;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({...(process.env.TB_BROWSER?{executablePath:process.env.TB_BROWSER}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const jevNetwork=[];
page.on('requestfailed',request=>{if(request.url().includes('/api/bridge/'))jevNetwork.push({url:request.url(),error:request.failure()?.errorText});});
page.on('response',response=>{if(response.url().includes('/api/bridge/'))jevNetwork.push({url:response.url(),status:response.status()});});
page.on('pageerror',error=>errors.push(String(error)));
const check=(name,condition)=>{assert.ok(condition,name);results.push(name);console.log('PASS '+name)};
const ready=()=>page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='ready');
const state=()=>page.evaluate(()=>window.__tavernBattleNative.service.snapshot());
const idle=async frame=>frame.locator('body:not([aria-busy="true"])').waitFor();
const scene=JSON.parse(readFileSync('artifacts/layered-browser/fixture.json','utf8'));
const install=async()=>{await page.evaluate(async state=>{await __tavernBattleNative.service.transact(()=>structuredClone(state))},scene.state);};
try {
  await page.goto(url);await ready();await install();
  await page.locator('#tavern-battle-native-entry').click();
  const frame=page.frameLocator('#tavern-battle-native-panel iframe');await frame.locator('#app h1').waitFor();
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();await idle(frame);
  check('11x17 city is rendered from the saved layered battlefield',await frame.locator('.grid-cell').count()===187);
  check('city, structure and core-region classes are present',await frame.locator('.structure-wall').count()>0&&await frame.locator('.control-region').count()>1);
  const before=JSON.stringify((await state()).battle);
  await frame.locator(`.grid-cell[data-cell="${scene.gate}"]`).click();await idle(frame);
  check('inspection does not mutate battle state',JSON.stringify((await state()).battle)===before);
  check('structure inspector includes HP and distinct interaction buttons',await frame.locator('.map-inspector').innerText().then(t=>t.includes('耐久')&&t.includes('登城')));
  await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:true});
  const hp=(await state()).battle.snap.battlefield.structures[scene.gate].hp;
  await frame.locator('[data-action="grid-structure"][data-mode="primary"]').click();await idle(frame);
  const afterHit=(await state()).battle.snap.battlefield.structures[scene.gate].hp;
  check('real UI breach action persists structure damage',afterHit<hp&&afterHit>0);
  await page.reload();await ready();await page.locator('#tavern-battle-native-entry').click();await frame.locator('#app h1').waitFor();
  check('refresh preserves damaged structures', (await state()).battle.snap.battlefield.structures[scene.gate].hp===afterHit);
  await install();await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();await idle(frame);
  await frame.locator(`.grid-cell[data-cell="${scene.gate}"]`).click();await idle(frame);
  await frame.locator('[data-action="grid-climb"]').click();await idle(frame);
  check('real UI climb persists height and spends action', (await state()).battle.snap.combatants.find(u=>u.id==='ally').elevation===1);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  check('mobile map stays scrollable rather than clipping the page',await frame.locator('.grid-board').evaluate(el=>{let p=el.parentElement;while(p&&p!==document.body){if(['auto','scroll'].includes(getComputedStyle(p).overflowX))return p.scrollWidth>=p.clientWidth;p=p.parentElement;}return false;}));
  await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});
  check('no unhandled browser exceptions',errors.length===0);
} catch(error) {
  console.error(error);process.exitCode=1;
  console.error('PAGE ERRORS',errors);try{await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});}catch{}
} finally {
  writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:process.exitCode?'failed':'passed',metadataMode,results,errors,realHost:false},null,2)+'\n');
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
