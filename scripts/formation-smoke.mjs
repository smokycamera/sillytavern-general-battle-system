import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/formation-fixture.ts'], { encoding: 'utf8' }));
const flightFixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/formation-fixture.ts', '--flight'], { encoding: 'utf8' }));
const recoveryFixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/formation-fixture.ts', '--recovery'], { encoding: 'utf8' }));
const panicFixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/formation-fixture.ts', '--panic'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(`<!doctype html><script>
const vars={panel:${JSON.stringify(fixture)}};
window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:(value)=>{if(window.failSave)throw Error('test save failure');Object.assign(vars,value);}};
window.SillyTavern={getContext:()=>({chatId:'formation-test',characterId:0,characters:[{avatar:'test.png'}]})};
window.readBattle=()=>vars.panel.battle.snap;
window.readPanel=()=>vars.panel;
window.loadFixture=(save)=>{vars.panel=save;localStorage.clear();};
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
const tailOnly = process.argv.includes('--tail-only');
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 844 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html);
  const p = page.frameLocator('#panel');
  const idle = () => p.locator('body:not([aria-busy="true"])').waitFor(); await p.locator('.formation-grid').waitFor();
  async function openDetails(selector) {
    const d = p.locator(selector);
    if (!await d.evaluate((el) => el.open)) await d.locator(':scope > summary').click(); await idle();
  }
  async function selectActor(id) {
    await openDetails('.formation-order-list');
    await p.locator('[data-action="formation-select-actor"][data-id="' + id + '"]').click(); await idle();
  }
  async function choose(id, type) {
    await selectActor(id); await openDetails('.formation-adjust');
    await p.locator('[data-role="formation-order"]').selectOption(type); await idle();
  }
  async function target(id) { await openDetails('.formation-adjust'); await p.locator('[data-role="formation-target"]').selectOption(id); await idle(); }
  async function ability(id, label) {
    await selectActor(id); await openDetails('.formation-adjust');
    const value = await p.locator('[data-role="formation-order"] option').evaluateAll((options, label) => options.find((o) => o.textContent.includes(label))?.value, label);
    assert.ok(value, '实际技能存在：' + label);
    await p.locator('[data-role="formation-order"]').selectOption(value); await idle();
  }
  async function issue() { await p.locator('[data-action="formation-issue"]').click(); await idle(); }
  async function task(id) { await selectActor(id); return p.locator('[data-role="formation-order"]').inputValue(); }
  async function checkLayout() {
  const stable = await page.evaluate(() => JSON.stringify(window.readBattle())); mkdirSync('panel/smoke-shots', { recursive: true });
  if (!process.argv.includes('--skip-layout')) for (const width of [320, 390, 736, 1024]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    for (const theme of ['dark', 'light']) {
      await p.locator('body').evaluate((el, value) => { el.dataset.theme = value; }, theme);
      const layout = await p.locator('.formation-grid').evaluate((el) => ({ count: el.children.length, overflow: document.documentElement.scrollWidth - innerWidth,
        hit: [...el.querySelectorAll('button')].every((b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44) }));
      assert.equal(layout.count, 18); assert.ok(layout.hit); assert.ok(layout.overflow <= 1, JSON.stringify({ width, ...layout }));
      if (await p.locator('.formation-mobile-summary').isVisible()) {
        await p.locator('.formation-mobile-summary').click(); await idle();
        const command = await p.locator('.formation-actor').boundingBox(), dock = await p.locator('.mass-controls').boundingBox();
        if (theme === 'dark' && width <= 390) await page.screenshot({ path: 'panel/smoke-shots/formation-command-' + width + '.png' });
        assert.ok(command.y >= -1 && command.y + command.height <= dock.y, '当前任务入口可返回可见编队信息：' + JSON.stringify({ width, command, dock }));
      }
      await p.locator('.formation-grid').evaluate((el) => el.parentElement.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `panel/smoke-shots/formation-${width}-${theme}.png` });
      assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), stable);
      console.log(`✓ ${width}/${theme}：18阵位、触控≥44px、无页面横溢出、视图操作不改战果`);
    }
  }
  }
  if (process.argv.includes('--layout-only')) {
    const facts = await page.evaluate(() => JSON.stringify(window.readBattle()));
    await p.locator('[data-action="formation-unit"][data-id="reserve"]').click(); await idle();
    assert.match(await p.locator('.formation-actor').innerText(), /预备步队/);
    await p.locator('[data-action="formation-cell"][data-node="ally:中军:rear"]').focus();
    await p.locator('[data-action="formation-cell"][data-node="ally:中军:rear"]').press('Enter');
    assert.equal(await page.evaluate(() => window.readPanel().orderDraft.reserve.type), 'rank-forward');
    assert.equal(await p.locator('[data-formation="ally:中军:rear"].destination').count(), 1);
    await p.locator('[data-action="formation-cancel"]').click(); await idle();
    await choose('a', 'volley');
    await p.locator('[data-action="formation-unit"][data-id="enemy"]').click(); await idle();
    assert.equal(await page.evaluate(() => window.readPanel().orderDraft.a.targetId), 'enemy');
    assert.equal(await p.locator('[data-id="enemy"].targeted').count(), 1);
    assert.match(await p.locator('.formation-preview').innerText(), /命中/);
    await p.locator('[data-action="formation-cancel"]').click(); await idle();
    assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), facts);
    await p.locator('.formation-adjust').evaluate((el) => { el.open = false; });
    console.log('✓ 地图点队、键盘选阵位、机动草案与落点、点敌选目标、取消均不推进战斗/RNG');
    await checkLayout();
  }
  else {
  if (!process.argv.includes('--morale-only')) {
  if (!tailOnly) {
  await choose('a', 'volley');
  await target('enemy');
  assert.match(await p.locator('.formation-preview').textContent(), /命中/);
  await ability('a', '呼叫援军');
  await issue();
  let snap = await page.evaluate(() => window.readBattle());
  assert.equal(snap.orders.find((o) => o.unitId === 'a').type, 'ability');
  assert.equal(snap.combatants.find((u) => u.id === 'hero').resources.reserve, 1);
  await choose('reserve', 'hold');
  await p.locator('.mass-controls [data-action="formation-fill"]').click(); await idle();
  assert.equal(await task('reserve'), 'hold');
  assert.equal(await p.locator('[data-action="mass-resolve"]').count(), 1);
  const control = await p.locator('[data-action="mass-resolve"]').boundingBox();
  assert.ok(control.y >= 0 && control.y + control.height <= 844, '自动军令后执行按钮仍可见');
  await p.locator('[data-action="mass-resolve"]').click(); await idle();
  snap = await page.evaluate(() => window.readBattle());
  assert.equal(snap.round, 2); assert.equal(snap.combatants.find((u) => u.id === 'hero').resources.reserve, 0);
  assert.ok(snap.combatants.some((u) => u.summonerId === 'hero'));
  assert.equal(snap.previousOrders.find(([id]) => id === 'reserve')[1].type, 'hold');
  assert.equal(snap.lastPhases.length, 5);
  assert.equal(await task('reserve'), 'hold');
  const inspecting = await page.evaluate(() => JSON.stringify(window.readBattle()));
  await p.locator('[data-action="formation-unit"][data-id="enemy"]').click(); await idle();
  assert.equal(await task('reserve'), 'hold', '查看敌人不会把继承的休整改成攻击');
  assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), inspecting);
  assert.match(await p.locator('.mass-round-feedback').innerText(), /第1轮已执行/);
  assert.equal(snap.roundReport.phases.length, 5);
  assert.equal(snap.roundReport.orders.find((r) => r.order.unitId === 'a').status, 'executed');
  console.log('✓ 随队技能排令不扣费→自动军令保留草案→可见执行入口→支援扣费/召唤/五阶段保存');
  await checkLayout();
  }
  const forward = structuredClone(fixture); forward.battle = null;
  // Current mode selection uses entity count, not company headcount: >16 starts mass combat.
  for (let n = 0; forward.storage.length < 17; n++) {
    const extra = structuredClone(forward.storage.find(u => u.id === (n % 2 ? 'a' : 'enemy')));
    extra.id = extra.snapshot.id = 'formation-extra-' + n;
    extra.zone = n % 4 < 2 ? '左翼' : '右翼'; extra.rank = n < 8 ? 'front' : 'rear';
    for (const slot of ['weapon', 'armor']) if (extra.snapshot[slot]) extra.snapshot[slot].id = extra.id + ':' + slot;
    extra.snapshot.tags = extra.snapshot.tags.filter(t => !t.startsWith('zone:') && !t.startsWith('rank:'));
    forward.storage.push(extra); forward.rosterIds.push(extra.id);
  }
  const reserve = forward.storage.find((u) => u.id === 'reserve'); reserve.traits.push('vanguard'); reserve.snapshot.traits.push('vanguard');
  await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save: forward, html });
  await p.locator('[data-action="mass-start"]').click(); await idle(); await p.locator('.formation-grid').waitFor();
  const deployed = await page.evaluate(() => window.readBattle());
  assert.ok(deployed.combatants.find((u) => u.id === 'reserve').tags.includes('rank:rear'));
  assert.equal(deployed.combatants.find((u) => u.id === 'reserve').vanguardOrigin, 'ally:中军:reserve');
  assert.match(await p.locator('[data-formation="ally:中军:rear"]').innerText(), /预备步队/);
  assert.ok(deployed.log.some((e) => e.text.includes('先锋部署')));
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator('.formation-grid').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), JSON.stringify(deployed));
  console.log('✓ 会战先锋：正式开战前出一层→己方阵位可见→战前偏好单独保存→重开不累计');
  await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save: flightFixture, html }); await p.locator('.formation-grid').waitFor();
  await choose('a', 'rank-forward');
  assert.match(await p.locator('.formation-preview').innerText(), /敌方中军支援空域/);
  await issue(); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle();
  let flying = await page.evaluate(() => window.readBattle()); assert.equal(flying.combatants.find((u) => u.id === 'a').formationPosition, 'enemy:中军:rear'); assert.equal(flying.combatants.find((u) => u.id === 'a').airborne, true);
  assert.match(await p.locator('[data-formation="enemy:中军:rear"]').innerText(), /我 ·.*空中/s);
  await page.setViewportSize({ width: 390, height: 844 }); await p.locator('.formation-grid').evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.screenshot({ path: 'panel/smoke-shots/mass-flight-cross-390.png' });
  await choose('a', 'attack'); await target('enemy');
  assert.match(await p.locator('.formation-preview').innerText(), /先降落/);
  await issue(); const beforeDive = await page.evaluate(() => JSON.stringify(window.readBattle()));
  await p.locator('body').evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.failSave) throw Error('test quota'); return original.apply(this, args); }; }); await page.evaluate(() => { window.failSave = true; });
  await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle(); assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), beforeDive); assert.match(await p.locator('[data-role="save-status"]').innerText(), /未保存/);
  await page.evaluate(() => { window.failSave = false; }); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle();
  flying = await page.evaluate(() => window.readBattle()); assert.equal(flying.combatants.find((u) => u.id === 'a').airborne, false); assert.equal(flying.combatants.find((u) => u.id === 'a').fatigue, 1.5);
  assert.ok(flying.log.some((e) => e.resolution?.attackerId === 'a'));
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator('.formation-grid').waitFor(); assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), JSON.stringify(flying));
  console.log('✓ 会战飞行：正式军令跨过前线→后排空域与阵营可见→扑击预览→整轮保存失败回退→重试落地攻击/疲劳→重开');
  await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save: recoveryFixture, html }); await p.locator('.formation-grid').waitFor();
  await selectActor('a'); await openDetails('.formation-unit-details');
  assert.match(await p.locator('.formation-unit-details').innerText(), /可救伤兵10/);
  await ability('a', '随队恢复剂');
  await target('a'); assert.match(await p.locator('.formation-preview').innerText(), /(?:可救伤兵|恢复).*7/);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'panel/smoke-shots/mass-recovery-preview-390.png' });
  await issue(); const recoveryBefore = await page.evaluate(() => JSON.stringify(window.readPanel()));
  await p.locator('body').evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.failSave) throw Error('test quota'); return original.apply(this, args); }; }); await page.evaluate(() => { window.failSave = true; });
  await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle(); assert.equal(await page.evaluate(() => JSON.stringify(window.readPanel())), recoveryBefore);
  await page.evaluate(() => { window.failSave = false; }); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle();
  const recovered = await page.evaluate(() => window.readBattle()), recoveredUnit = recovered.combatants.find((u) => u.id === 'a');
  assert.equal(recoveredUnit.hp, 90); assert.equal(recoveredUnit.recoverableWounded, 0); assert.equal(recovered.combatants.find((u) => u.id === 'hero').resources['item:mass-dose'], 1);
  assert.ok(recovered.log.some((l) => l.text.includes('再生 +3')));
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator('.formation-grid').waitFor(); assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), JSON.stringify(recovered));
  console.log('✓ 会战伤兵：独立伤兵显示→随队用药预览7→双写失败整轮撤回→治疗7加再生3守恒/同扣量→重开');
  }
  const moraleCase = structuredClone(fixture), officer = moraleCase.battle.snap.combatants.find((u) => u.id === 'hero'), scary = moraleCase.battle.snap.combatants.find((u) => u.id === 'enemy');
  officer.traits.push('commander'); officer.tags = officer.tags.filter((t) => !t.startsWith('rank:')).concat('rank:reserve'); moraleCase.battle.snap.attached = [['reserve', 'hero']]; scary.traits.push('fear'); scary.weapon.baseDice = '1d2';
  await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save: moraleCase, html }); await p.locator('.formation-grid').waitFor();
  await selectActor('a'); assert.match(await p.locator('.formation-status').innerText(), /恐惧压力8.*攻击降低1/);
  await choose('a', 'volley'); await target('enemy'); await issue();
  await choose('reserve', 'rank-forward'); await issue(); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle();
  const supported = await page.evaluate(() => window.readBattle()); const shot = supported.log.find((l) => l.resolution?.attackerId === 'a').resolution;
  const firingUnit = supported.combatants.find((u) => u.id === 'a');
  assert.equal(shot.netAtk, firingUnit.base.atk + firingUnit.weapon.pointBlankPenalty); assert.match(shot.atkDetail, /抵近射击/);
  await selectActor('a'); assert.match(await p.locator('.formation-status').innerText(), /附近统率10/); assert.doesNotMatch(await p.locator('.formation-status').innerText(), /攻击降低/);
  console.log('✓ 会战统率：后方指挥超距无效→随宿主前移进入支援范围→实际齐射抵消恐惧，不复制个人主任务');
  await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save: panicFixture, html }); await p.locator('.formation-grid').waitFor();
  const panicBefore = await page.evaluate(() => JSON.stringify(window.readBattle()));
  await p.locator('body').evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.failSave) throw Error('test quota'); return original.apply(this, args); }; }); await page.evaluate(() => { window.failSave = true; });
  await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle(); assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), panicBefore);
  await page.evaluate(() => { window.failSave = false; }); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle(); const routed = await page.evaluate(() => window.readBattle());
  assert.equal(routed.combatants.find((u) => u.id === 'a').status, 'routing'); assert.deepEqual(routed.combatants.find((u) => u.id === 'a').moraleState.terrorSeen, ['enemy']);
  assert.equal(routed.combatants.find((u) => u.id === 'hero').hp, 100); assert.doesNotMatch(await p.locator('body').innerText(), /主帅倒下/); await selectActor('a'); assert.match(await p.locator('.formation-status').innerText(), /剩余3次机会/);
  await page.setViewportSize({ width: 390, height: 844 }); await p.locator('.formation-command').evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: 'panel/smoke-shots/mass-rally-pending-390.png' });
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator('.formation-grid').waitFor(); assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), JSON.stringify(routed));
  await p.locator('.mass-controls [data-action="mass-resolve"]').click(); await idle(); const rallied = await page.evaluate(() => window.readBattle());
  assert.equal(rallied.combatants.find((u) => u.id === 'a').status, 'ready'); assert.equal(rallied.combatants.find((u) => u.id === 'a').moraleState.attempts, 1); assert.equal(rallied.commanderLost, false);
  console.log('✓ 会战惊退：双写失败回退触发/RNG→重试只触发一次→随队未阵亡/剩余机会可见→重开→下一整轮重整并恢复指挥');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
