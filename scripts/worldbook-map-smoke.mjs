import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/p4-tactical-fixture.ts', '--json'], {encoding:'utf8'}));
fixture.battle.snap.turnOrder = ['a','c','b','d','e'];
fixture.battle.snap.searchCoverage = {ally:Array(91).fill(1)};
const fire = fixture.battle.snap.combatants.find(u=>u.id==='a').abilities.find(a=>a.definitionId==='bp-firestorm');
const root = path.resolve('release/native-candidate'), output = path.resolve('artifacts/worldbook-map-review');
mkdirSync(output,{recursive:true});
const disk = new Map(), checks = [], errors = [];
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script>
window.__TAURITAVERN__={};window.handlers=new Map();window.prompts={};
window.context={characterId:0,characters:[{avatar:'fixture.png',name:'Fixture'}],chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},
eventTypes:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','WORLD_INFO_ACTIVATED','WORLDINFO_ENTRIES_LOADED','MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHAT_CHANGED'].map(k=>[k,k])),
eventSource:{on(k,fn){const set=handlers.get(k)||new Set();set.add(fn);handlers.set(k,set)},removeListener(k,fn){handlers.get(k)?.delete(fn)},async emit(k,...args){for(const fn of handlers.get(k)||[])await fn(...args)}},
getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){},setExtensionPrompt(id,value){prompts[id]=value},
async saveMetadata(){await fetch('/fixture/save',{method:'POST',body:JSON.stringify({id:context.chatId,metadata:context.chatMetadata})})},
async saveChat(){await context.saveMetadata()}};
window.SillyTavern={getContext:()=>context};
localStorage.setItem('tb:llm:settings:v1',JSON.stringify({enabled:true,url:'https://example.invalid/v1',token:'',model:'fixture',models:[],windowSize:6,worldbookMode:'character',worldbooks:[{name:'手动书',entries:'all'}]}));
</script><script type="module" src="/extension/index.js"></script>`;
const server = http.createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
    if(url.pathname==='/scripts/user.js'){res.setHeader('Content-Type','text/javascript');res.end('export const accountsEnabled=false; export function getCurrentUserHandle(){return "tauri-contract"}');return;}
    if(url.pathname==='/script.js'){res.setHeader('Content-Type','text/javascript');res.end('export const isChatSaving=false;');return;}
    if(req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type','application/json');
      if(url.pathname==='/fixture/save'){disk.set(body.id,structuredClone(body.metadata));res.end('{}');return;}
      if(url.pathname==='/api/chats/get'){res.end(JSON.stringify([{chat_metadata:disk.get(body.file_name)??{}}]));return;}
    }
    const file=path.resolve(root,decodeURIComponent(url.pathname).replace(/^\/extension\//,''));
    assert.ok(file.startsWith(root+path.sep));
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(readFileSync(file));
  }catch(error){res.statusCode=404;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.TB_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
const check=(name,result)=>{assert.ok(result,name);checks.push(name);console.log('PASS '+name)};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='ready');
  await page.evaluate(async fixture=>{
    await __tavernBattleNative.service.transact(()=>fixture);
    await context.eventSource.emit('GENERATION_STARTED','normal',{},false);
    await context.eventSource.emit('WORLD_INFO_ACTIVATED',[{world:'角色书',uid:1,comment:'蓝灯',content:'常驻'},{world:'角色书',uid:2,comment:'绿灯',content:'命中内容'}]);
    await context.eventSource.emit('GENERATION_ENDED');
  },fixture);
  check('Tauri event contract captures actual blue/green activation before opening the panel',await page.evaluate(async()=>{
    const books=await __tavernBattleNative.worldbooks.active();return !document.querySelector('iframe')&&books[0].entries.map(e=>e.id).join(',')==='1,2';
  }));
  await page.locator('#tavern-battle-native-entry').click();
  const frame=page.frameLocator('#tavern-battle-native-panel iframe');
  const idle=()=>frame.locator('body:not([aria-busy="true"])').waitFor();
  await frame.locator('.grid-board').waitFor();
  await frame.locator('[data-action="workspace-tab"][data-tab="settings"]').click();
  await frame.locator('[data-detail-id="llm-worldbooks"] summary').click();
  check('binding mode is visible and manual selections survive mode changes',await frame.locator('[data-role="llm-worldbook-mode"]').inputValue()==='character');
  await frame.locator('[data-role="llm-worldbook-mode"]').selectOption('manual');
  await frame.locator('[data-role="llm-worldbook-mode"]').selectOption('character');
  check('switching modes preserves manual selections',await frame.locator('body').evaluate(()=>JSON.parse(localStorage.getItem('tb:llm:settings:v1')).worldbooks[0].name==='手动书'));
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').click();
  await frame.locator('[data-action="grid-mode"][data-mode="'+fire.id+'"]').click();
  await frame.locator('.grid-cell[data-cell="31"]').click();
  await frame.locator('.command-finish [data-action="grid-execute"]').click();await idle();
  const arrow=await frame.locator('.battle-trace').evaluate(svg=>{
    window.savedTrace=svg;
    const line=svg.querySelector('line'),point=new DOMPoint(Number(line.getAttribute('x2')),Number(line.getAttribute('y2'))).matrixTransform(svg.getScreenCTM());
    const target=document.querySelector('.grid-cell[data-cell="31"]').getBoundingClientRect();
    return {error:Math.hypot(point.x-target.left-target.width/2,point.y-target.top-target.height/2),active:svg.classList.contains('trace-active')};
  });
  check('area skill arrow lands on the chosen target center',arrow.error<1&&arrow.active);
  check('damage float appears at the resolved victim',await frame.locator('.grid-cell[data-cell="31"] .battle-damage-float').count()===1);
  await frame.locator('[data-action="grid-mode"][data-mode="move"]').click();
  check('view redraw preserves the same arrow and playback class',await frame.locator('.battle-trace').evaluate(svg=>svg===window.savedTrace&&svg.classList.contains('trace-active')));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:1000});
    const sizes=await frame.locator('.grid-cell.reachable.recently-searched').first().evaluate(cell=>{
      const overlay=getComputedStyle(cell,'::after'),mark=cell.querySelector('.grid-search-mark').getBoundingClientRect();
      return {width:parseFloat(overlay.width),height:parseFloat(overlay.height),cell:cell.getBoundingClientRect().width,mark:mark.width};
    });
    check(`${width}px searched movement cells retain a full-cell blue overlay and separate 4px marker`,sizes.width>=sizes.cell-1&&sizes.height>=sizes.cell-1&&sizes.mark===4);
    await page.screenshot({path:path.join(output,width===390?'mobile.png':'desktop.png')});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    window.panelWrites=0;const service=__tavernBattleNative.service,save=service.persistPanel.bind(service);
    service.persistPanel=(...args)=>{window.panelWrites++;return save(...args)};
  });
  await frame.locator('[data-action="grid-endturn"]').click();await idle();
  check('manual next ally turn saves once and immediately selects the new actor',await page.evaluate(()=>panelWrites===1)&&await frame.locator('.command-actor h3').innerText()==='受伤队友');
  await page.evaluate(async()=>{
    await context.eventSource.emit('GENERATION_STARTED','normal',{},false);await context.eventSource.emit('GENERATION_ENDED');
  });
  check('an empty next activation does not resend previous green entries',await page.evaluate(async()=>(await __tavernBattleNative.worldbooks.active()).length===0));
  await page.evaluate(()=>__tavernBattleNative.dispose());
  check('Tauri removeListener cleanup leaves no event subscriptions',await page.evaluate(()=>[...handlers.values()].every(set=>set.size===0)));
  check('no browser exceptions',errors.length===0);
}catch(error){process.exitCode=1;console.error(error);await page.screenshot({path:path.join(output,'failure.png')});}
finally{
  writeFileSync(path.join(output,'report.json'),JSON.stringify({status:process.exitCode?'failed':'passed',checks,errors,host:'synthetic Tauri event and account contract',realHost:false},null,2)+'\n');
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
