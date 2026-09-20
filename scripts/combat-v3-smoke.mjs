import { chromium } from 'playwright-core';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture=(...flags)=>JSON.parse(execFileSync(process.execPath,['node_modules/vite-node/vite-node.mjs','scripts/combat-v3-fixture.ts',...flags],{encoding:'utf8'}));
const small=fixture(),mass=fixture('--mass'),html=readFileSync('panel/dist/index.html','utf8'),errors=[],checks=[];
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><script>
const vars={};window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:value=>Object.assign(vars,value)};
window.SillyTavern={getContext:()=>({chatId:'combat-v3-smoke',characterId:0,characters:[{avatar:'fixture.png'}]})};
window.loadFixture=save=>{vars.panel=save;localStorage.clear();};window.readPanel=()=>vars.panel;
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
mkdirSync('panel/smoke-shots',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const p=page.frameLocator('#panel');
 const load=async save=>{await page.evaluate(({save,html})=>{window.loadFixture(save);document.querySelector('#panel').srcdoc=html;},{save,html});};
 const prepared=structuredClone(small);delete prepared.battle;await load(prepared);await p.locator('[data-action="small-start"]').click();await p.locator('.grid-board').waitFor();
 assert.equal(await page.evaluate(()=>window.readPanel().battle.snap.rulesId),'v4-overflow-d20');checks.push('面板新开小战采用V4；以下旧V3快照保持原规则');
 for(const [mode,save] of [['small',small],['mass',mass]]){
  await load(save);await p.locator(mode==='mass'?'.formation-grid':'.grid-board').waitFor();
  if(mode==='small'){
   await p.locator('.command-modes button').filter({hasText:'攻击'}).click();await p.locator('[data-role="grid-target"]').selectOption('D');
  }else{
   await p.locator('.formation-adjust > summary').click();await p.locator('[data-role="formation-order"]').selectOption('volley');await p.locator('[data-role="formation-target"]').selectOption('D');
  }
  const command=p.locator(mode==='mass'?'.formation-command':'.grid-command');assert.match(await command.innerText(),/现员 500\/500 · 成员耐久 10/);assert.match(await command.innerText(),/有效投送 .*分 8 组判定/);
  const stable=await page.evaluate(()=>JSON.stringify(window.readPanel().battle.snap));
  for(const width of [390,1024]){
   await page.setViewportSize({width,height:844});await command.evaluate(el=>el.scrollIntoView({block:'start'}));
   assert.ok(await p.locator('html').evaluate(el=>el.scrollWidth-innerWidth<=1),'无页面横向溢出');
   await page.screenshot({path:`panel/smoke-shots/combat-v3-${mode}-${width}.png`});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(window.readPanel().battle.snap)),stable);checks.push(mode+'人数/耐久/参与人数可见，390与1024宽度无横溢出，预览不改变快照');
  await page.setViewportSize({width:1024,height:844});
  if(mode==='mass'){await p.locator('[data-action="formation-issue"]').click();await p.locator('.mass-controls [data-action="mass-resolve"]').click();}
  else await p.locator('.command-finish [data-action="grid-execute"]').click();
  const after=await page.evaluate(()=>window.readPanel().battle.snap);
  assert.ok(after.log.some(e=>e.resolution?.packetCount===8));for(const u of after.combatants)assert.equal(u.formation.members,u.hp);
  await page.evaluate(html=>{document.querySelector('#panel').srcdoc=html;},html);await p.locator(mode==='mass'?'.formation-grid':'.grid-board').waitFor();
  assert.equal(await page.evaluate(()=>JSON.stringify(window.readPanel().battle.snap)),JSON.stringify(after));checks.push(mode+'执行留下8组聚合记录，刷新后人数、战报与随机状态原样恢复');
 }
 assert.deepEqual(errors,[]);writeFileSync('engine/sim/out/combat-v3-browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
