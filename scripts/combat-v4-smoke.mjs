import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture=(...flags)=>JSON.parse(execFileSync(process.execPath,['node_modules/vite-node/vite-node.mjs','scripts/combat-v4-fixture.ts',...flags],{encoding:'utf8'}));
const cases=[['small',fixture()],['mass',fixture('--mass')]],html=readFileSync('panel/dist/index.html','utf8'),checks=[],errors=[];
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><script>
const vars={};window.sent=[];window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:value=>Object.assign(vars,value),sendMessageAsUser:async text=>{window.sent.push(text);return true;}};
window.SillyTavern={getContext:()=>({chatId:'combat-v4-smoke',characterId:0,characters:[{avatar:'fixture.png'}]})};window.loadFixture=save=>{vars.panel=save;localStorage.clear();};window.readPanel=()=>vars.panel;
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const p=page.frameLocator('#panel'),read=()=>page.evaluate(()=>window.readPanel()),load=async save=>{await page.evaluate(({save,html})=>{window.loadFixture(save);document.querySelector('#panel').srcdoc=html;},{save,html});};
 await load(cases[0][1].before);await p.locator('.workspace-nav [data-tab="units"]').click();
 if(!await p.locator('[data-role="gen-name"]').isVisible())await p.locator('[data-action="gen-toggle"]').click();
 await p.locator('[data-role="gen-name"]').fill('十二辆自定义生命车辆');await p.locator('[data-role="gen-scale"]').selectOption('company');
 await p.locator('[data-detail-id="gen-body"] > summary').click();await p.locator('[data-role="gen-body"]').selectOption('vehicle');await p.locator('[data-role="gen-hpMax"]').fill('12');await p.locator('[data-role="gen-memberHp"]').fill('100');
 await p.locator('[data-action="gen-add"]').click();assert.match(await p.locator('[data-role="builder-preview"]').innerText(),/总生命 1200\/1200/);await p.locator('[data-action="builder-confirm"]').click();
 const created=(await read()).storage.find(u=>u.name==='十二辆自定义生命车辆');assert.equal(created.snapshot.formation.memberHp,100);assert.deepEqual(created.snapshot.formation.health,[{hp:100,count:12}]);checks.push('实际新建界面保存12辆、每辆100生命，预览与归档均为1200总生命');
 await load(cases[0][1].before);await p.locator('[data-action="small-start"]').click();await p.locator('.grid-board').waitFor();assert.equal((await read()).battle.snap.rulesId,'v4-d20');checks.push('实际新开战使用V4，并保留预先受伤的成员生命');
 for(const [mode,data] of cases){
  await load(data.active);await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();
  if(mode==='small'){await p.locator('.command-modes button').filter({hasText:'攻击'}).click();await p.locator('[data-role="grid-target"]').selectOption('D');}
  else{await p.locator('.formation-adjust > summary').click();await p.locator('[data-role="formation-order"]').selectOption('volley');await p.locator('[data-role="formation-target"]').selectOption('D');}
  await p.locator('body').evaluate(()=>{window.mapRemovals=0;new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n.nodeType===1&&(n.matches('.grid-board,.grid-cell,.formation-grid,.formation-node')||n.querySelector('.grid-board,.grid-cell,.formation-grid,.formation-node')))window.mapRemovals++;}).observe(document.body,{subtree:true,childList:true});});
  const ammo=p.locator('[data-role="cannon-ammo"]');await ammo.selectOption('ap');assert.equal((await read()).battle.snap.combatants.find(u=>u.id==='A').cannonAmmo,'ap');
  const command=p.locator(mode==='small'?'.grid-command':'.formation-command');assert.match(await command.innerText(),/穿透\s*16/);
  await ammo.selectOption('he');assert.match(await command.innerText(),/穿透\s*14/);assert.equal(await p.locator('body').evaluate(()=>window.mapRemovals),0);
  assert.ok(await p.locator('html').evaluate(el=>el.scrollWidth-innerWidth<=1));await command.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:`panel/smoke-shots/combat-v4-${mode}-battle-390.png`});
  const before=await read(),initial=before.battle.snap.combatants.find(u=>u.id==='D').formation.health.reduce((n,g)=>n+g.hp*g.count,0);
  if(mode==='small')await p.locator('.command-finish [data-action="grid-execute"]').click();else{await p.locator('[data-action="formation-issue"]').click();await p.locator('.mass-controls [data-action="mass-resolve"]').click();}
  const acted=await read(),target=acted.battle.snap.combatants.find(u=>u.id==='D'),after=target.formation.health.reduce((n,g)=>n+g.hp*g.count,0),resolutions=acted.battle.snap.log.filter(e=>e.resolution?.attackerId==='A').map(e=>e.resolution);
  assert.ok(after<initial);assert.equal(resolutions.reduce((n,r)=>n+r.finalDamage,0),initial-after);assert.ok(resolutions.some(r=>r.splashDamage>0));
  const snapshot=JSON.stringify(acted.battle.snap);await page.evaluate(html=>{document.querySelector('#panel').srcdoc=html;},html);await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();assert.equal(JSON.stringify((await read()).battle.snap),snapshot);
  await p.locator('[data-detail-id="battle-options"] > summary').click();await p.locator('[data-action="battle-finish"][data-reason="ceasefire"]').click();
  const saved=await read(),report=saved.reports.at(-1);assert.ok(report.epilogue.includes('生命损失'));assert.ok(report.epilogue.includes('73/100生命'));assert.deepEqual(saved.storage.find(u=>u.id==='D').snapshot.formation.health,target.formation.health);
  await p.locator('.workspace-nav [data-tab="reports"]').click();await p.locator('[data-detail-id="report-send-preview"] > summary').click();assert.match(await p.locator('.report-preview').innerText(),/总生命/);
  assert.ok(await p.locator('html').evaluate(el=>el.scrollWidth-innerWidth<=1));await p.locator('.report-preview').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:`panel/smoke-shots/combat-v4-${mode}-390.png`});
  await p.locator('.report-send-actions [data-action="out-epilogue"]').click();await p.locator('.report-send-actions [data-action="out-epilogue"][disabled]').waitFor();assert.equal(await page.evaluate(()=>window.sent.at(-1)),report.epilogue);
  await p.locator('[data-action="report-restart"]').click();await p.locator('[data-action="report-restart-confirm"]').click();await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();
  const restarted=await read();assert.deepEqual(restarted.battle.snap.combatants.find(u=>u.id==='C').formation.health,[{hp:73,count:1},{hp:100,count:11}]);assert.equal(restarted.battle.snap.combatants.find(u=>u.id==='D').hp,12);
  checks.push(mode+'切换弹种改变穿透且地图不重建；真实射击伤损正确归档、刷新保留；终章发送生命事实，重战恢复开局受伤车辆；390宽度无横溢出');
 }
 assert.deepEqual(errors,[]);writeFileSync('engine/sim/out/combat-v4-browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
