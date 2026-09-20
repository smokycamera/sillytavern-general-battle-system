import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const initial = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/narrative-hardening-fixture.ts'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><script>
  const vars={panel:${JSON.stringify(initial)}}; const handlers={}; let messages=[]; const chat=[];
  window.__injections=[];
  window.eventOn=(name,fn)=>{(handlers[name]??=[]).push(fn)};
  window.fire=(name,...args)=>(handlers[name]??[]).forEach(fn=>fn(...args));
  window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:(value)=>Object.assign(vars,value),
    tavern_events:{GENERATION_AFTER_COMMANDS:'before',GENERATION_ENDED:'end',MESSAGE_RECEIVED:'received',CHAT_CHANGED:'changed'},
    getChatMessages:(range)=>range===-1?[messages.at(-1)]:messages,
    _bind:{_eventOn:(name,fn)=>{window.eventOn(name,fn);return{stop:()=>{handlers[name]=handlers[name].filter(f=>f!==fn)}}}}};
  window.SillyTavern={getContext:()=>({chatId:'hardening-test',characterId:0,characters:[{avatar:'test.png'}],chat,
    setExtensionPrompt:(...args)=>{if(args[1] && !Number.isFinite(args[3]))throw Error('invalid injection depth');window.__injections.push(args)}})};
  window.readPanel=()=>vars.panel;
  window.loadSave=(value)=>{vars.panel=value;localStorage.clear();window.fire('changed')};
  window.generate=(text)=>{window.fire('before','normal',{},false);const id=messages.length;
    messages.push({role:'assistant',message:text,message_id:id,swipe_id:0,swipes:[text]});chat[id]={mes:text,gen_finished:'2026-09-06',swipe_id:0};
    window.fire('received',id,'normal');window.fire('end',id)};
  </script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const p = page.frameLocator('#panel');
  const reopen = async () => { await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); };
  await reopen(); await p.locator('.battle-preparation').waitFor();
  if (!process.argv.includes('--narrative-only')) {
  assert.equal(await p.locator('[data-action="mass-start"]').isDisabled(), true);
  assert.match(await p.locator('.battle-preparation [role="alert"]').innerText(), /33.*32/);
  assert.equal((await page.evaluate(() => window.readPanel())).storage.length, 33);
  const valid = structuredClone(initial); valid.rosterIds = valid.rosterIds.slice(0, 32);
  await page.evaluate((save) => window.loadSave(save), valid); await reopen(); await p.locator('[data-action="mass-start"]').waitFor();
  await p.locator('[data-action="mass-start"]').click(); await p.locator('.formation-grid').waitFor();
  const battle = await page.evaluate(() => window.readPanel().battle.snap);
  assert.equal(battle.combatants.length, 32); assert.ok(battle.combatants.every((u) => u.hp === 80));
  await reopen(); await p.locator('.formation-grid').waitFor();
  assert.deepEqual(await page.evaluate(() => window.readPanel().battle.snap), battle);
  }
  const small = { ...structuredClone(initial), storage: initial.storage.slice(0, 1), rosterIds: [initial.storage[0].id] };
  await page.evaluate((save) => window.loadSave(save), small); await reopen(); await p.locator('.battle-preparation').waitFor();
  assert.ok((await page.evaluate(() => window.__injections.filter((a) => a[1]))).every((a) => a[2] === 1 && a[3] === 0 && a[4] === false));
  await page.evaluate(() => window.generate('<tb>' + '<spawn name="士兵" side="enemy" scale="hero" count="20"/>'.repeat(4) + '</tb>'));
  await page.waitForFunction(() => window.readPanel().proposals?.at(-1)?.status === 'unresolved');
  assert.equal((await page.evaluate(() => window.readPanel())).storage.length, 1);
  assert.match(await page.evaluate(() => window.readPanel().proposals.at(-1).reason), /本批新建单位超过32/);
  assert.doesNotMatch(await page.evaluate(() => window.__injections.at(-1)[1]), /上次候选未应用/);
  assert.match(await p.locator('.narrative-alert').innerText(), /超过32/);
  await p.locator('[data-action="narrative-review"]').click();
  assert.equal(await p.locator('.narrative-history').evaluate((el) => el.open), true);
  await page.evaluate(() => window.generate('<tb><spawn name="守备连" side="enemy" scale="company" hpMax="80" weapon="步枪L5"/></tb>'));
  await p.locator('[data-action="workspace-tab"][data-tab="units"]').first().click();
  await p.locator('[data-action="narrative-approve"]').last().waitFor();
  await p.locator('[data-action="narrative-approve"]').last().click();
  await page.waitForFunction(() => window.readPanel().storage.length === 2);
  const save = await page.evaluate(() => window.readPanel());
  assert.equal(save.storage[1].hp, 80); assert.equal(save.storage[1].base.hpMax, 80); assert.equal(save.rosterIds.length, 2);
  await reopen(); await p.locator('.battle-preparation').waitFor();
  assert.equal((await page.evaluate(() => window.readPanel())).storage[1].id, save.storage[1].id);
  mkdirSync('panel/smoke-shots', { recursive: true });
  await page.screenshot({ path: 'panel/smoke-shots/narrative-hardening-390.png' });
  assert.deepEqual(errors, []);
  console.log('✓ ' + (process.argv.includes('--narrative-only') ? '仅复查正文尾段：' : '33卡阻止开战/保留档案→32卡自动合法布阵/重开→') + '末尾有限深度注入→80卡整批拒绝及反馈→改写80人编队/真实审批/重开');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
