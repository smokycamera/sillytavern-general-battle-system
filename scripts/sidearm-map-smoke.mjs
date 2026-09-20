import {chromium} from 'playwright-core';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';

const fixture=(file,...flags)=>JSON.parse(execFileSync(process.execPath,['node_modules/vite-node/vite-node.mjs',file,...flags],{encoding:'utf8'}));
const cases=[['small',fixture('scripts/combat-v3-fixture.ts')],['mass',fixture('scripts/combat-v3-fixture.ts','--mass')]];
const inventory=fixture('scripts/inventory-fixture.ts');
const owner=inventory.storage.find(r=>r.id==='a');
owner.snapshot.sidearm=structuredClone(owner.snapshot.weapon);
owner.snapshot.sidearm.id+=':secondary';owner.snapshot.sidearm.name='试改副武器';
const sidearmId=owner.snapshot.sidearm.id;
const html=readFileSync('panel/dist/index.html','utf8'),checks=[],errors=[];
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><script>
const vars={};window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:value=>Object.assign(vars,value)};
window.SillyTavern={getContext:()=>({chatId:'sidearm-map-smoke',characterId:0,characters:[{avatar:'fixture.png'}]})};
window.loadFixture=save=>{vars.panel=save;localStorage.clear();};window.readPanel=()=>vars.panel;
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
mkdirSync('panel/smoke-shots',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const p=page.frameLocator('#panel');
 const load=async save=>{await page.evaluate(({save,html})=>{window.loadFixture(save);document.querySelector('#panel').srcdoc=html;},{save,html});};
 for(const [mode,save] of cases){
  await load(save);await p.locator(mode==='small'?'.grid-board':'.formation-grid').waitFor();
  await p.locator('body').evaluate((body,mode)=>{
   const camera=document.querySelector(mode==='small'?'.grid-camera':'.formation-map-camera');
   const board=camera.firstElementChild, workspace=document.querySelector('[data-workspace="battle"]');
   const protectedNodes=new Set([camera,board,...camera.querySelectorAll(mode==='small'?'.grid-cell':'.formation-node')]);
   for(let el=camera.parentElement;el&&el!==workspace;el=el.parentElement)protectedNodes.add(el);
   const probe={camera,board,protectedNodes,removed:0,positions:[],before:null,select:null};window.selectionProbe=probe;
   new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(protectedNodes.has(node))probe.removed++;}).observe(workspace,{childList:true,subtree:true});
   for(const type of ['click','change'])body.addEventListener(type,e=>{
    const element=e.target.closest('[data-action],[data-role]');
    if(!element||!['grid-cell','grid-mode','formation-cell','formation-unit'].includes(element.dataset.action)&&!['grid-target','formation-target','formation-order'].includes(element.dataset.role))return;
    const before=[camera.scrollLeft,camera.scrollTop];
    queueMicrotask(()=>probe.positions.push({before,after:[camera.scrollLeft,camera.scrollTop]}));
   },true);
  },mode);
  const before=await page.evaluate(()=>JSON.stringify(window.readPanel().battle.snap));
  for(const width of [390,1024]){
   await page.setViewportSize({width,height:844});
   if(mode==='small'){
    await p.locator('.command-modes button').filter({hasText:'攻击'}).click();
    await p.locator('[data-role="grid-target"]').evaluate(el=>{window.selectionProbe.select=el;el.focus();});
    await p.locator('[data-role="grid-target"]').selectOption('D');
    assert.equal(await p.locator('[data-role="grid-target"]').evaluate(el=>window.selectionProbe.select===el&&document.activeElement===el),true,'目标选择保留原下拉框与焦点');
    for(const cell of [21,20,21])await p.locator('.grid-board [data-cell="'+cell+'"]').evaluate(el=>el.click());
    await p.locator('.command-modes button').filter({hasText:'技能'}).click();
    assert.match(await p.locator('.action-preview').innerText(),/主目标预计损失/);
   }else{
    const details=p.locator('.formation-adjust');if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
    await p.locator('[data-role="formation-order"]').selectOption('volley');
    await p.locator('[data-role="formation-target"]').evaluate(el=>{window.selectionProbe.select=el;el.focus();});
    await p.locator('[data-role="formation-target"]').selectOption('D');
    assert.equal(await p.locator('[data-role="formation-target"]').evaluate(el=>window.selectionProbe.select===el&&document.activeElement===el),true);
    for(const node of ['enemy:中军:front','ally:中军:front','enemy:中军:front'])await p.locator('[data-action="formation-cell"][data-node="'+node+'"]').evaluate(el=>el.click());
   }
   assert.ok(await p.locator('html').evaluate(el=>el.scrollWidth-innerWidth<=1),'页面不横溢出');
   if(width===390)await page.screenshot({path:'panel/smoke-shots/sidearm-map-'+mode+'-390.png'});
  }
  const probe=await p.locator('body').evaluate(()=>({removed:window.selectionProbe.removed,positions:window.selectionProbe.positions,connected:[...window.selectionProbe.protectedNodes].every(n=>n.isConnected)}));
  assert.equal(probe.removed,0,mode+'地图节点不应临时移出文档');assert.equal(probe.connected,true);
  for(const pos of probe.positions)assert.deepEqual(pos.after,pos.before,mode+'选择不改变地图滚动');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.readPanel().battle.snap)),before,'查看与草案不推进战斗');
  checks.push({mode,viewportWidths:[390,1024],events:probe.positions.length,mapNodesRemoved:probe.removed,scrollPreserved:true,focusPreserved:true,battleUnchanged:true});
 }
 await load(inventory);await p.locator('.workspace-nav [data-tab="inventory"]').click();
 await p.locator('.inventory-card').filter({hasText:'试改副武器'}).locator('[data-action="inventory-edit"]').click();
 await p.locator('[data-role="inventory-mechanism"]').selectOption('cannon');await p.locator('[data-role="inventory-power"]').fill('6');
 await p.locator('[data-action="inventory-preview-draft"]').click();await p.locator('[data-action="inventory-confirm"]').click();
 const saved=await page.evaluate(()=>window.readPanel()),after=saved.storage.find(r=>r.id==='a').snapshot.sidearm;
 assert.equal(after.recipe.mechanism,'cannon');assert.equal(after.recipe.power,6);assert.equal(after.id,sidearmId);
 assert.equal(saved.inventory.find(i=>i.id===sidearmId).equippedTo.slot,'sidearm');
 checks.push({sidearm:'已装备副武器直接改造为L6重炮，身份、槽位和保存投影保留'});
 assert.deepEqual(errors,[]);
 writeFileSync('engine/sim/out/sidearm-map-20260915-browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
