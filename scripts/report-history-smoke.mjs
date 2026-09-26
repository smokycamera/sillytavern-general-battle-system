import {chromium} from 'playwright-core';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture=(...flags)=>JSON.parse(execFileSync(process.execPath,['node_modules/vite-node/vite-node.mjs','scripts/report-history-fixture.ts',...flags],{encoding:'utf8'}));
const small=fixture(),mass=fixture('--mass'),html=readFileSync('panel/dist/index.html','utf8'),checks=[],errors=[];
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><script>
const vars={};window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:value=>{if(window.failSave)throw Error('test save failure');Object.assign(vars,value)}};
window.SillyTavern={getContext:()=>({chatId:'report-history-smoke',characterId:0,characters:[{avatar:'fixture.png'}]})};
window.loadFixture=save=>{vars.panel=save;localStorage.clear();};window.readPanel=()=>vars.panel;
const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){if(window.failSave)throw Error('test quota');return originalSet.apply(this,args);};
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
mkdirSync('panel/smoke-shots',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const p=page.frameLocator('#panel'),tab=async name=>p.locator('.workspace-nav [data-tab="'+name+'"]').click();
 const load=async save=>{await page.evaluate(({save,html})=>{window.loadFixture(save);document.querySelector('#panel').srcdoc=html;},{save,html});};
 const read=()=>page.evaluate(()=>window.readPanel());
 // 实际新开战入口保存开局，而非在结算时用残血状态重建。
 await load(small.before);await p.locator('[data-action="small-start"]').click();await p.locator('.grid-board').waitFor();
 const opened=await read();assert.equal(opened.activeBattleStart.snapshot.round,1);assert.equal(opened.activeBattleStart.before.storage[0].hp,400);
 assert.equal(opened.activeBattleStart.snapshot.combatants.find(u=>u.id==='A').hp,400);
 checks.push('新战在自动行动前保存开局阵容、档案与携行状态');
 for(const [mode,fixture] of [['small',small],['mass',mass]]){
  await load(fixture.finished);await tab('reports');
  const original=await read(),id=original.reports[0].id;
  assert.equal(await p.locator('[data-action="report-restart"]').isEnabled(),true);
  await p.locator('[data-action="report-restart"]').click();
  assert.match(await p.locator('.report-restart-preview').innerText(),/物品数量/);
  if(mode==='small'){
   await page.setViewportSize({width:390,height:844});await p.locator('.report-restart-preview').evaluate(el=>el.scrollIntoView({block:'start'}));
   assert.ok(await p.locator('html').evaluate(el=>el.scrollWidth-innerWidth<=1));await page.screenshot({path:'panel/smoke-shots/report-restart-390.png'});
   await p.locator('body').evaluate(()=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){if(window.parent.failSave)throw Error('test quota');return old.apply(this,args);};});
   await page.evaluate(()=>{window.failSave=true;});await p.locator('[data-action="report-restart-confirm"]').click();
   const failed=await read();assert.deepEqual(failed.storage,original.storage);assert.deepEqual(failed.inventory,original.inventory);assert.deepEqual(failed.battle,original.battle);assert.deepEqual(failed.reports,original.reports);
   await page.evaluate(()=>{window.failSave=false;});await p.locator('[data-action="report-restart"]').click();
   checks.push('重战保存双路失败，原伤亡、经验、库存和报告均保持，能够重新预览后重试');
  }
  await p.locator('[data-action="report-restart-confirm"]').click();await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();
  const replay=await read();assert.notEqual(replay.battle.snap.seed,original.battle.snap.seed);assert.deepEqual(replay.storage,original.reports[0].start.before.storage);assert.deepEqual(replay.inventory,original.reports[0].start.before.inventory);
  assert.deepEqual(replay.committedOutcomeIds,original.committedOutcomeIds);assert.equal(replay.reports[0].supersededBy,mode+':'+replay.battle.snap.seed);
  const snapshot=JSON.stringify(replay.battle);await page.evaluate(html=>{document.querySelector('#panel').srcdoc=html;},html);await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();assert.equal(JSON.stringify((await read()).battle),snapshot);
  checks.push(mode+'恢复原开局与物品，XP回到战前，使用新编号；刷新后重战状态保持');
  await p.locator('[data-detail-id="battle-options"] > summary').click();
  await p.locator('[data-action="battle-finish"][data-reason="ceasefire"]').click();
  const settled=await read(),newId=mode+':'+settled.battle.snap.seed;
  assert.equal(settled.reports.length,2);assert.equal(settled.reports.find(r=>r.id===newId).start.replacesReportId,id);
  assert.deepEqual(settled.committedOutcomeIds,[id,newId]);
  assert.equal(settled.storage.find(r=>r.id==='A').xp??0,original.reports[0].start.before.storage.find(r=>r.id==='A').xp??0);
  await tab('reports');assert.equal(await p.locator('[data-action="report-restart"]').isEnabled(),true);
  await p.locator('[data-action="report-delete"]').click();await tab('battle');
  assert.match(await p.locator('.battle-exit').innerText(),/已入账.*已删除/);
  await p.locator('[data-action="battle-close"]').click();assert.equal((await read()).reports.some(r=>r.id===newId),false);
  await tab('reports');await p.locator('[data-action="report-restore"]').click();
  assert.equal(await p.locator('[data-action="report-restart"]').isEnabled(),true);
  checks.push(mode+'重战重新归档且原XP不叠加；删除当前报告后收兵不复活报告，撤销后仍可按新战果再次重战');
 }
 // 删除与撤销支持旧报告，并且不会重开战斗或取消已入账结果。
 const closed=structuredClone(small.finished);closed.battle=null;closed.activeBattleStart=undefined;
 await load(closed);await tab('reports');await p.locator('[data-action="report-delete"]').click();
 let deleted=await read();assert.equal(deleted.reports.length,0);assert.deepEqual(deleted.committedOutcomeIds,closed.committedOutcomeIds);assert.deepEqual(deleted.storage,closed.storage);assert.deepEqual(deleted.inventory,closed.inventory);
 await page.evaluate(html=>{document.querySelector('#panel').srcdoc=html;},html);await tab('reports');await p.locator('[data-action="report-restore"]').click();assert.equal((await read()).reports[0].id,closed.reports[0].id);
 const old=structuredClone(closed);delete old.reports[0].start;await load(old);await tab('reports');assert.equal(await p.locator('[data-action="report-restart"]').isDisabled(),true);assert.match(await p.locator('.report-workspace').innerText(),/没有开局存档记录/);
 await p.locator('[data-action="report-delete"]').click();assert.equal((await read()).reports.length,0);
 const advanced=structuredClone(closed);advanced.storage[0].hp--;await load(advanced);await tab('reports');assert.equal(await p.locator('[data-action="report-restart"]').isDisabled(),true);assert.match(await p.locator('.report-workspace').innerText(),/已经变化/);
 checks.push('删除→刷新→撤销保留报告与入账记录；旧报告可删除，缺快照或已有后续变化时重战不可用');
 assert.deepEqual(errors,[]);writeFileSync('engine/sim/out/report-history-20260915-browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
