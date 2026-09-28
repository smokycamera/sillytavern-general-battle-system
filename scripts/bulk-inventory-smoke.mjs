/** Browser coverage of the real built panel, host persistence and mobile inventory. */
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture=JSON.parse(execFileSync(process.execPath,['node_modules/vite-node/vite-node.mjs','scripts/bulk-inventory-fixture.ts'],{encoding:'utf8'}));
const offline=process.argv.includes('--offline');
let html=readFileSync('panel/dist/index.html','utf8');
// Offline mode exercises UI and mocked host persistence without a network origin.
if(offline) html=html.replace('<head>',`<head><script>Object.defineProperty(window,'localStorage',{value:{getItem:k=>parent.offlineStore[k]??null,setItem:(k,v)=>{if(parent.testFail)throw Error('test quota');parent.offlineStore[k]=String(v);},removeItem:k=>delete parent.offlineStore[k],clear:()=>{parent.offlineStore={};}}});</script>`);
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><body></body>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.TB_BROWSER || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[],results=[];mkdirSync('artifacts/bulk-inventory',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:950}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 if(offline) await page.setContent('<!doctype html><body></body>');
 else await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(({fixture,html})=>{
  document.body.style.margin='0';window.testVars={panel:fixture};window.testFail=false;window.saveCount=0;window.offlineStore={};
  window.SillyTavern={getContext:()=>({chatId:'bulk-smoke',characterId:0,characters:[{avatar:'bulk.png'}],chat:[],setExtensionPrompt:()=>{}})};
  window.TavernHelper={getVariables:()=>window.testVars,insertOrAssignVariables:next=>{if(window.testFail)throw Error('test save failure');window.saveCount++;Object.assign(window.testVars,structuredClone(next));}};
  window.openPanel=()=>{document.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.id='panel';frame.style='width:100%;height:930px;border:0';frame.srcdoc=html;document.body.append(frame);};window.openPanel();
 },{fixture,html});
 const panel=page.frameLocator('#panel'),root=panel.locator('#inventory-panel');
 const tab=()=>panel.locator('.workspace-nav [data-tab="inventory"]').click();
 const button=name=>root.locator(`[data-action="inventory-${name}"]`);
 const save=()=>page.evaluate(()=>structuredClone(window.testVars.panel));
 await tab();
 for(const width of [320,390,690,1280]){
  await page.setViewportSize({width,height:950});
  for(const name of ['bulk','new'])assert.equal(await button(name).isVisible(),true);
  assert.equal(await root.locator('[data-action="loadout-skills"]').isVisible(),true);
  const layout=await root.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('.inventory-title-actions button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,width:r.width,right:r.right};}),right:el.getBoundingClientRect().right}));
  assert.ok(layout.scroll<=layout.client+1,`overflow at ${width}: ${JSON.stringify(layout)}`);
  assert.ok(layout.buttons.every(b=>b.x>=0&&b.right<=layout.right+1),`buttons clipped at ${width}`);
  await page.screenshot({path:`artifacts/bulk-inventory/normal-${width}.png`});results.push({width,layout});
 }
 await page.setViewportSize({width:390,height:950});
 const before=await save();const initialRoll=before.inventory.find(i=>i.id==='spare').mechanics.value.recipe.variance;
 assert.ok(initialRoll);
 await root.locator('[data-inventory-id="spare"] .item-rules summary').click();
 assert.ok((await root.locator('[data-inventory-id="spare"] .item-rules').innerText()).includes('固定浮动'));
 await button('bulk').click();
 assert.equal(await root.locator('.item-actions:visible').count(),0);
 assert.equal(await root.locator('[data-role="inventory-select"]:enabled').count(),3);
 assert.ok(await root.locator('[data-role="inventory-select"]:disabled').count()>0);
 await button('select-all').click();assert.equal(await button('delete-selected').innerText(),'删除（3）');
 await page.screenshot({path:'artifacts/bulk-inventory/selected-390.png'});
 await button('delete-selected').click();assert.ok((await root.locator('[data-role="inventory-preview"]').innerText()).includes('删除已选的3项物品？'));
 assert.deepEqual(await save(),before);await button('cancel').click();
 await root.locator('[data-role="inventory-unit"]').selectOption('b');assert.equal(await button('delete-selected').innerText(),'删除（0）');
 await root.locator('[data-role="inventory-unit"]').selectOption('a');await button('select-all').click();await button('delete-selected').click();
 await root.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){if(parent.testFail)throw Error('test quota');return original.apply(this,args);};});
 await page.evaluate(()=>window.testFail=true);await button('confirm').click();
 await root.locator('[data-role="inventory-feedback"] .grid-reason').waitFor();assert.deepEqual(await save(),before);
 await page.evaluate(()=>window.testFail=false);const writes=await page.evaluate(()=>window.saveCount);
 await button('confirm').click();await root.locator('[data-role="inventory-preview"]').waitFor({state:'detached'});
 const after=await save();assert.equal(after.factRevision,before.factRevision+1);
 assert.equal(after.inventoryOperations.length,(before.inventoryOperations?.length??0)+1);
 assert.equal(await page.evaluate(()=>window.saveCount)-writes,1);
 for(const id of ['spare','potion','own'])assert.equal(after.inventory.find(i=>i.id===id).qty,0);
 assert.equal(after.inventory.find(i=>i.id==='other').qty,20);
 assert.deepEqual(after.inventory.filter(i=>i.equippedTo),before.inventory.filter(i=>i.equippedTo));
 await page.evaluate(()=>window.openPanel());await tab();assert.equal(await root.locator('[data-inventory-id="spare"]').count(),0);
 assert.deepEqual((await save()).inventory.find(i=>i.id==='spare').mechanics.value.recipe.variance,initialRoll);
 assert.deepEqual(errors,[]);
 writeFileSync('artifacts/bulk-inventory/results.json',JSON.stringify({passed:true,offline,viewports:results,hostSaves:1,atomicDeletedStacks:3,failedSaveRetry:true,protectedEquipment:true,reload:true,errors},null,2));
 console.log('PASS: 320/390/690/1280px; visible-only select-all; equipped protection; single confirmation/save; failed-save retry; reload; fixed RNG detail.');
}finally{await browser.close();server.close();}
