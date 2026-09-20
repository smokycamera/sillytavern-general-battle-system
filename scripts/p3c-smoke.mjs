import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixtures = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/p3c-fixture.ts'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(`<!doctype html><script>
const vars={}; window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:(value)=>Object.assign(vars,value)};
window.SillyTavern={getContext:()=>({chatId:'p3c-mock',characterId:0,characters:[{avatar:'mock.png'}]})};
window.readPanel=()=>vars.panel; window.loadFixture=(save)=>{vars.panel=save;localStorage.clear();};
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 844 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.setDefaultTimeout(8000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); const p = page.frameLocator('#panel');
  const read = () => page.evaluate(() => window.readPanel().battle.snap);
  const load = async (save) => { await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save, html }); await p.locator('h1').waitFor(); };
  mkdirSync('panel/smoke-shots', { recursive: true });
  let snap;
  if (!process.argv.includes('--vehicle-only') && !process.argv.includes('--area-only')) {
  await load(fixtures.rider); await p.locator('.grid-board').waitFor();
  await p.locator('[data-action="grid-cell"][data-cell="52"]').click(); await p.locator('[data-action="grid-move"]').click();
  await p.locator('[data-role="grid-target"]').selectOption('b'); const before = await read();
  await p.locator('[data-action="grid-execute"]').click(); snap = await read();
  assert.equal(snap.combatants.find((u) => u.id === 'a').pos, 52); assert.ok(snap.actedThisTurn.includes('a'));
  assert.ok(snap.log.some((l) => l.resolution?.attackerId === 'a' && !l.resolution.atkDetail.includes('移动射击')));
  assert.notDeepEqual(snap, before); console.log('✓ 正式小战骑射：真坐骑移动→射击预览→同一主行动，免移动射击惩罚');

  await load(fixtures.physical); await p.locator('[data-role="grid-mode"]').selectOption(fixtures.physical.battle.snap.combatants[0].abilities[0].id);
  assert.match(await p.locator('.action-preview').innerText(), /使用近战副剑/);
  await p.locator('[data-action="grid-execute"]').click(); snap = await read();
  const hit = snap.log.find((l) => l.resolution?.attackerId === 'a').resolution;
  assert.equal(hit.channel, 'kinetic'); assert.equal(hit.participants, 6); assert.ok(snap.actedThisTurn.includes('a'));
  console.log('✓ 正式物理技能：实际副剑预览→有限展开/真实通道→共享行动保存');

  await load(fixtures.control); await p.locator('[data-role="grid-mode"]').selectOption(fixtures.control.battle.snap.combatants[0].abilities[0].id);
  const preview = await p.locator('.action-preview').innerText(); assert.match(preview, /束缚|定身/); assert.match(preview, /迫降概率/);
  await page.setViewportSize({ width: 390, height: 844 }); await p.locator('.grid-command').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'panel/smoke-shots/p3c-control-preview-390.png' });
  const start = await read(); await p.locator('[data-action="grid-execute"]').click(); snap = await read();
  assert.ok(snap.actedThisTurn.includes('a')); assert.ok(snap.combatants.find((u) => u.id === 'a').resources.SP < start.combatants.find((u) => u.id === 'a').resources.SP);
  const controlled = snap.combatants.find((u) => u.id === 'b');
  assert.ok(controlled.conditions.some((c) => c.id === 'restrained')); assert.equal(controlled.airborne, false);
  await load({ ...fixtures.control, battle: { kind: 'small', snap } }); assert.deepEqual(await read(), snap);
  console.log('✓ 正式控制：概率与迫降预览→实际束缚/降落/扣费→重开不重复执行');
  }

  if (!process.argv.includes('--area-only')) {
  await page.setViewportSize({ width: 1024, height: 844 }); await load(fixtures.vehicle); await p.locator('.formation-grid').waitFor();
  await p.locator('.formation-adjust > summary').click();
  await p.locator('[data-role="formation-order"]').selectOption('volley'); await p.locator('[data-role="formation-target"]').selectOption('b');
  assert.match(await p.locator('.formation-preview').innerText(), /稳定|行进|短移/);
  await p.locator('[data-action="formation-issue"]').click();
  await p.locator('[data-action="mass-resolve"]').click(); snap = await read();
  const vehicle = snap.combatants.find((u) => u.id === 'a'); assert.ok(vehicle.formationPosition === 'ally:中军:rear' || vehicle.tags.includes('rank:rear'), JSON.stringify({ unit: { tags: vehicle.tags, position: vehicle.formationPosition }, orders: snap.orders, log: snap.log })); assert.equal(vehicle.weapon.recipe.stabilized, true);
  assert.equal(vehicle.armor.recipe.protectionProfile, 'thermal'); assert.equal(vehicle.mount, undefined); assert.equal(snap.reloadCd.find(([id]) => id === 'a')[1], 1);
  assert.equal(snap.log.filter((l) => l.resolution?.attackerId === 'a').length, 1);
  await load({ ...fixtures.vehicle, battle: { kind: 'mass', snap } }); assert.deepEqual(await read(), snap);
  console.log('✓ 正式车辆：同任务短移开炮→装填/专项装甲保存→重开，无骑乘身份');
  }
  if (!process.argv.includes('--vehicle-only')) {
    await load(fixtures.area); await p.locator('[data-role="grid-mode"]').selectOption(fixtures.area.battle.snap.combatants[0].abilities[0].id);
    assert.match(await p.locator('.action-preview').innerText(), /至多4名成员暴露/);
    await page.setViewportSize({ width: 390, height: 844 }); await p.locator('.action-preview').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: 'panel/smoke-shots/p3c-area-preview-390.png' });
    await p.locator('[data-action="grid-execute"]').click(); snap = await read();
    assert.ok(snap.combatants.find((u) => u.id === 'b').hp < 500); assert.ok(snap.actedThisTurn.includes('a'));
    await load({ ...fixtures.area, battle: { kind: 'small', snap } }); assert.deepEqual(await read(), snap);
    console.log('✓ 正式范围法术：群体暴露和疏散说明→真实伤亡/同一行动→冻结配方重开');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
