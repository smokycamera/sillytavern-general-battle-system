import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';

const resume = process.argv.includes('--after-setup') ? JSON.parse(readFileSync('artifacts/p4-inventory-setup.json', 'utf8')) : null;
const fixture = resume?.save ?? JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/inventory-fixture.ts'], { encoding: 'utf8' }));
const massFixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/formation-fixture.ts', '--items'], { encoding: 'utf8' }));
// 只固定测试环境的开战种子，连续战斗仍取得不同身份；执行的面板/引擎代码不替换。
const html = readFileSync('panel/dist/index.html', 'utf8').replace('<head>', '<head><script>crypto.getRandomValues = (array) => { const n = parent.testSeedSeq++; for (let i = 0; i < array.length; i++) array[i] = (n + i) % 256; return array; };</script>');
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><body></body>'); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ fixture, html, sequence }) => {
    document.body.style.margin = '0';
    window.testVars = { panel: fixture }; window.testFail = false; window.testChat = 'inventory-test'; window.testSeedSeq = sequence;
    window.SillyTavern = { getContext: () => ({ chatId: window.testChat, characterId: 0, characters: [{ avatar: 'inventory.png' }], chat: [], setExtensionPrompt: () => {} }) };
    window.TavernHelper = {
      getVariables: () => window.testVars,
      insertOrAssignVariables: (next) => { if (window.testFail) throw new Error('test save failure'); Object.assign(window.testVars, structuredClone(next)); },
    };
    window.panelHtml = html;
    window.openPanel = () => {
      document.getElementById('panel')?.remove();
      const frame = document.createElement('iframe'); frame.id = 'panel'; frame.style = 'width:100%;height:880px;border:0'; frame.srcdoc = html; document.body.append(frame);
    };
    window.openPanel();
  }, { fixture, html, sequence: resume?.sequence ?? 0 });
  const panel = page.frameLocator('#panel');
  const root = panel.locator('#inventory-panel');
  await panel.locator('.workspace-nav [data-tab="inventory"]').click();
  await root.waitFor({ state: 'attached' });
  const tab = (name) => panel.locator('.workspace-nav [data-tab="' + name + '"]').click();
  const reveal = async (locator) => {
    for (const detail of await locator.locator('xpath=ancestor::details').all())
      if (!await detail.evaluate((e) => e.open)) await detail.locator('summary').first().click();
  };
  const mode = async (id) => {
    await panel.locator('.command-modes button').filter({ hasText: ['weapon', 'weapon:sidearm', 'charge'].includes(id) ? '攻击' : '技能' }).click();
    await panel.locator('[data-role="grid-mode"]').selectOption(id);
  };
  if (!process.argv.includes('--mass-only')) {
  await tab('inventory');
  await root.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.testFail) throw Error('test quota'); return original.apply(this, args); }; });
  const save = () => page.evaluate(() => structuredClone(window.testVars.panel));
  const itemRow = (name) => root.locator('.inventory-card').filter({ has: panel.locator('b', { hasText: name }) });
  const confirm = async () => {
    assert.equal(await root.locator('[data-action="inventory-confirm"]').count(), 1, 'missing confirmation: ' + await root.locator('[data-role="inventory-feedback"]').innerText());
    await root.locator('[data-action="inventory-confirm"]').click();
  };
  let current, upgraded = resume?.upgraded;
  if (!resume) {
  await root.locator('[data-action="inventory-new"]').click();
  await root.locator('[data-role="inventory-name"]').fill('测试大炮');
  await root.locator('[data-role="inventory-mechanism"]').selectOption('cannon');
  await reveal(root.locator('[data-role="inventory-body"]'));
  await root.locator('[data-role="inventory-body"]').selectOption('vehicle');
  await root.locator('[data-role="inventory-power"]').fill('6');
  const baseline = await save();
  await root.locator('[data-action="inventory-preview-draft"]').click();
  await root.locator('[data-role="inventory-preview"]').waitFor();
  assert.deepEqual(await save(), baseline, 'preview must not save or mutate facts');
  const firstPreview = await root.locator('[data-role="inventory-preview"]').innerText();
  await root.locator('[data-action="inventory-preview-draft"]').click();
  assert.equal(await root.locator('[data-role="inventory-preview"]').innerText(), firstPreview, 'same draft must not reroll');
  await confirm();
  current = await save(); const gun = current.inventory.find((i) => i.name === '测试大炮');
  assert.ok(gun?.mechanics); assert.equal(gun.qty, 1);
  await reveal(itemRow('测试大炮').locator('[data-action="inventory-equip"][data-slot="primary"]')); await itemRow('测试大炮').locator('[data-action="inventory-equip"][data-slot="primary"]').click();
  await confirm();
  current = await save();
  assert.equal(current.storage.find((r) => r.id === 'a').snapshot.weapon.id, gun.id);
  assert.equal(current.storage.find((r) => r.id === 'a').hp, 18);
  console.log('✓ 正式面板：重复预览不入库/重掷，生成大炮→实际换装，保持生命与训练');
  await itemRow('测试大炮').locator('[data-action="inventory-edit"]').click();
  await root.locator('[data-role="inventory-name"]').fill('附魔大炮');
  await root.locator('[data-role="inventory-power"]').fill('8');
  await reveal(root.locator('[data-role="inventory-enchantment"]'));
  await root.locator('[data-role="inventory-enchantment"]').selectOption('arcane');
  await root.locator('[data-action="inventory-preview-draft"]').click(); await confirm();
  current = await save();
  upgraded = current.inventory.find((i) => i.id === gun.id);
  assert.equal(upgraded.revision, 2); assert.equal(upgraded.mechanics.value.channel, 'arcane');
  assert.deepEqual(upgraded.history[0].mechanics, gun.mechanics);
  await itemRow('附魔大炮').locator('[data-action="inventory-unequip"]').click(); await confirm();
  await root.locator('[data-role="inventory-unit"]').selectOption('b');
  await itemRow('附魔大炮').locator('[data-action="inventory-assign"]').click(); await confirm();
  await reveal(itemRow('附魔大炮').locator('[data-action="inventory-equip"][data-slot="primary"]')); await itemRow('附魔大炮').locator('[data-action="inventory-equip"][data-slot="primary"]').click(); await confirm();
  current = await save();
  assert.equal(current.storage.find((r) => r.id === 'a').snapshot.weapon, undefined);
  assert.deepEqual(current.storage.find((r) => r.id === 'b').snapshot.weapon, upgraded.mechanics.value);
  await page.evaluate(() => window.openPanel()); await panel.locator('.workspace-nav [data-tab="inventory"]').click();
  await root.waitFor({ state: 'attached' }); await tab('inventory');
  assert.deepEqual((await save()).storage.find((r) => r.id === 'b').snapshot.weapon, upgraded.mechanics.value);
  console.log('✓ 正式面板：附魔/重铸保留实物与历史，卸下→转移→重新装备→重开保持精确实例');
  await root.locator('[data-role="inventory-unit"]').selectOption('a');
  await root.locator('[data-action="inventory-new"]').click();
  await root.locator('[data-role="inventory-kind"]').selectOption('consumable');
  await root.locator('[data-role="inventory-name"]').fill('恢复剂');
  await root.locator('[data-role="inventory-power"]').fill('3');
  await root.locator('[data-role="inventory-qty"]').fill('2');
  await root.locator('[data-action="inventory-preview-draft"]').click(); await confirm();
  const beforeUse = await save();
  await itemRow('恢复剂').locator('[data-action="inventory-use"]').click();
  await page.evaluate(() => { window.testFail = true; });
  await root.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) { if (window.parent.testFail) throw new Error('test quota'); return original.apply(this, args); };
  });
  await confirm();
  assert.deepEqual(await save(), beforeUse, 'failed save must not consume item or heal');
  assert.match(await root.locator('[data-role="inventory-feedback"]').innerText(), /失败|quota|保存/);
  await page.evaluate(() => { window.testFail = false; }); await confirm();
  current = await save();
  assert.equal(current.inventory.find((i) => i.name === '恢复剂').qty, 1);
  assert.ok(current.storage.find((r) => r.id === 'a').hp > 18);
  await itemRow('待鉴定旧剑').locator('[data-action="inventory-define"]').click();
  await root.locator('[data-action="inventory-preview-draft"]').click(); await confirm();
  current = await save();
  assert.equal(current.inventory.find((i) => i.id === 'legacy-sword').qty, 1);
  assert.equal(current.inventory.filter((i) => i.sourceItemId === 'legacy-sword').length, 1);
  console.log('✓ 正式面板：使用保存失败不扣数量/生命，重试一次生效；旧叙事库存补全一件保留余量');
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/p4-inventory-setup.json', JSON.stringify({ save: await save(), upgraded, sequence: await page.evaluate(() => window.testSeedSeq) }));
  }
  mkdirSync('panel/smoke-shots', { recursive: true });
  if (!process.argv.includes('--skip-layout')) for (const width of [320, 390, 736, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['dark', 'light']) {
      await root.evaluate((_root, theme) => { document.body.dataset.theme = theme; }, theme);
      const layout = await root.evaluate((element) => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
        small: [...element.querySelectorAll('button,select,input')].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5).length }));
      assert.equal(layout.overflow, false, `overflow ${width}/${theme}`); assert.equal(layout.small, 0, `touch targets ${width}/${theme}`);
      // Element screenshots cannot expand a fixed-height iframe: capture real scrollable viewports.
      await root.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `panel/smoke-shots/inventory-${width}-${theme}-top.png` });
      await root.locator('.inventory-card').last().evaluate((element) => element.scrollIntoView({ block: 'end' }));
      await page.screenshot({ path: `panel/smoke-shots/inventory-${width}-${theme}-bottom.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await root.locator('[data-role="inventory-unit"]').selectOption('a');
  await itemRow('恢复剂').locator('[data-action="inventory-assign"]').click(); await confirm();
  await tab('units');
  if (!(await panel.locator('[data-action="storage-into"][data-id="b"]').count())) await panel.locator('[data-action="manage-toggle"]').click();
  if (await panel.locator('[data-action="storage-into"][data-id="b"]').isEnabled()) await panel.locator('[data-action="storage-into"][data-id="b"]').click();
  assert.ok((await save()).rosterIds.includes('b'));
  await tab('battle');
  await panel.locator('[data-action="small-start"]').click();
  const active = (snapshot) => snapshot.battle.snap.turnOrder[snapshot.battle.snap.turnIndex];
  for (let n = 0; active(await save()) !== 'a' && n < 12; n++) await panel.locator('[data-action="grid-endturn"]').click();
  assert.equal(active(await save()), 'a');
  const dose = (await save()).inventory.find((i) => i.name === '恢复剂');
  await mode('item:' + dose.id);
  await panel.locator('[data-role="grid-target"]').selectOption('a');
  assert.match(await panel.locator('.action-preview').innerText(), /预计恢复\s*7生命/);
  await panel.locator('.grid-command').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'panel/smoke-shots/inventory-battle-390-preview.png' });
  const beforeBattleUse = await save();
  await page.evaluate(() => { window.testFail = true; });
  await panel.locator('.command-finish [data-action="grid-execute"]').click();
  assert.deepEqual(await save(), beforeBattleUse, 'battle save failure must roll back snapshot and stock together');
  assert.match(await panel.locator('[data-role="save-status"]').innerText(), /未保存/);
  await page.evaluate(() => { window.testFail = false; });
  await mode('item:' + dose.id);
  await panel.locator('[data-role="grid-target"]').selectOption('a');
  await panel.locator('.command-finish [data-action="grid-execute"]').click();
  current = await save();
  assert.equal(current.inventory.find((i) => i.id === dose.id).qty, 0);
  assert.equal(current.battle.snap.combatants.find((u) => u.id === 'a').hp, beforeBattleUse.battle.snap.combatants.find((u) => u.id === 'a').hp + 7);
  assert.ok(current.battle.snap.actedThisTurn.includes('a'));
  assert.equal(await panel.locator('.command-finish [data-action="grid-execute"]').isDisabled(), true);
  const afterBattleUse = current;
  await page.evaluate(() => window.openPanel()); await panel.locator('.workspace-nav [data-tab="inventory"]').click();
  await root.waitFor({ state: 'attached' });
  assert.deepEqual((await save()).battle, afterBattleUse.battle);
  assert.equal((await save()).inventory.find((i) => i.id === dose.id).qty, 0);
  console.log('✓ 正式战场：携行→预览→保存失败撤回→重试，一次治疗/扣量/主行动，重开不补回');
  await tab('battle');
  let manualShot = false;
  for (let n = 0; n < 100 && !(await panel.locator('[data-action="battle-close"]').count()); n++) {
    if (active(await save()) === 'b') {
      await mode('weapon');
      if (await panel.locator('[data-role="grid-target"] option[value="e"]').count()) await panel.locator('[data-role="grid-target"]').selectOption('e');
      // 自动行动会在移动后立即开火，无法证明玩家的确认路径；这里实际点格移动再确认攻击。
      for (let move = 0; move < 3 && !(await panel.locator('.command-finish [data-action="grid-execute"]').isEnabled()); move++) {
        const snapshot = (await save()).battle.snap, actor = snapshot.combatants.find((u) => u.id === 'b'), target = snapshot.combatants.find((u) => u.id === 'e');
        const spotted = !!(await panel.locator('[data-role="grid-target"] option[value="e"]').count());
        const destination = spotted ? target.pos : snapshot.battlefield.objective.cell;
        const width = snapshot.battlefield.width;
        await panel.locator('.command-modes button').filter({ hasText: '移动' }).click();
        const cells = await panel.locator('.grid-cell.reachable:not(.selected)').evaluateAll((elements) => elements.map((e) => Number(e.dataset.cell)));
        const score = (cell) => {
          const distance = Math.abs(cell % width - destination % width) + Math.abs(Math.floor(cell / width) - Math.floor(destination / width));
          return Math.abs(distance - (spotted ? Math.min(3, actor.weapon.range) : 0)) * 10 + (cell % width === destination % width ? 0 : 1);
        };
        const cell = cells.sort((a, b) => score(a) - score(b) || a - b)[0];
        if (cell === undefined) break;
        await panel.locator(`[data-action="grid-cell"][data-cell="${cell}"]`).click();
        if (!(await panel.locator('.move-preview [data-action="grid-move"]').isEnabled())) break;
        await panel.locator('.move-preview [data-action="grid-move"]').click();
        await mode('weapon');
        if (await panel.locator('[data-role="grid-target"] option[value="e"]').count()) await panel.locator('[data-role="grid-target"]').selectOption('e');
      }
      await mode('weapon');
      if (await panel.locator('.command-finish [data-action="grid-execute"]').isEnabled()) {
        await panel.locator('.command-finish [data-action="grid-execute"]').click(); manualShot = true;
        if (await panel.locator('[data-action="battle-close"]').count()) break;
      }
    }
    await panel.locator('[data-action="grid-endturn"]').click();
  }
  current = await save();
  assert.equal(manualShot, true, 'player must fire the actual reforged cannon: ' + JSON.stringify(current.battle.snap.log.slice(-8)));
  const shot = current.battle.snap.log.find((l) => l.resolution?.attackerId === 'b' && l.resolution.channel === 'arcane');
  assert.ok(shot, 'reforged attack evidence: ' + JSON.stringify(current.battle.snap.log.slice(-12))); const firedWeapon = current.battle.snap.combatants.find(u => u.id === 'b').weapon;
  assert.equal(firedWeapon.id, upgraded.mechanics.value.id);
  assert.equal(firedWeapon.recipe.power, 8);
  assert.equal(firedWeapon.channel, 'arcane');
  // V4 projects the frozen L8 cannon through the current anchor (2 * 8 + 2).
  assert.equal(shot.resolution.penetration, 18);
  assert.equal(shot.resolution.baseRoll.expr, '8d6');
  await panel.locator('.battle-exit [data-action="battle-close"]').click();
  current = await save();
  assert.equal(current.inventory.find((i) => i.id === dose.id).qty, 0);
  assert.equal(current.storage.find((r) => r.id === 'a').snapshot.abilities.some((s) => s.itemSourceId), false);
  assert.deepEqual(current.storage.find((r) => r.id === 'b').snapshot.weapon, upgraded.mechanics.value);
  await tab('units');
  if (!await panel.locator('[data-action="storage-into"][data-id="e2"]').count()) await panel.locator('[data-action="manage-toggle"]').click();
  await panel.locator('[data-action="storage-into"][data-id="e2"]').click();
  if (await panel.locator('[data-action="storage-into"][data-id="b"]').isEnabled()) await panel.locator('[data-action="storage-into"][data-id="b"]').click();
  assert.ok((await save()).rosterIds.includes('b'));
  await tab('battle');
  await panel.locator('[data-action="small-start"]').click();
  current = await save();
  assert.deepEqual(current.battle.snap.combatants.find((u) => u.id === 'b').weapon, upgraded.mechanics.value);
  assert.equal(current.battle.snap.combatants.some((u) => u.abilities.some((s) => s.itemSourceId === dose.id)), false);
  assert.deepEqual(errors, []);
  console.log('✓ 正式战场：改造炮实际手动开火/穿透与伤害骰→归档→下一战保持原炮，耗尽药剂不复生');
  }
  const saveMass = () => page.evaluate(() => structuredClone(window.testVars.panel));
  let massCurrent;
  await page.evaluate((fixture) => { window.testChat = 'inventory-mass-test'; window.testVars = { panel: fixture }; window.openPanel(); }, massFixture);
  await panel.locator('.formation-grid').waitFor();
  await panel.locator('.formation-adjust > summary').click();
  const skillKey = await panel.locator('[data-role="formation-order"] option').evaluateAll((options) => options.find((o) => o.textContent.includes('随队恢复剂'))?.value);
  assert.ok(skillKey);
  await panel.locator('[data-role="formation-order"]').selectOption(skillKey);
  await panel.locator('[data-role="formation-target"]').selectOption('hero');
  await panel.locator('[data-action="formation-issue"]').click();
  massCurrent = await saveMass();
  assert.equal(massCurrent.inventory[0].qty, 2, 'planning must not spend inventory');
  assert.equal(massCurrent.battle.snap.orders.find((o) => o.unitId === 'a').type, 'ability');
  await panel.locator('body').evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.testFail) throw Error('quota'); return original.apply(this, args); }; });
  await page.evaluate(() => { window.testFail = true; });
  const beforeRound = await saveMass();
  await panel.locator('[data-action="mass-resolve"]').click();
  assert.deepEqual(await saveMass(), beforeRound, 'mass round save failure must restore all phases and item stock');
  await page.evaluate(() => { window.testFail = false; });
  await panel.locator('[data-action="mass-resolve"]').click();
  massCurrent = await saveMass();
  assert.equal(massCurrent.inventory[0].qty, 1); assert.equal(massCurrent.battle.snap.combatants.find((u) => u.id === 'hero').hp, 17);
  assert.ok(massCurrent.battle.snap.log.some((l) => /恢复剂.*治疗 7/.test(l.text)));
  await page.evaluate(() => window.openPanel()); await panel.locator('.formation-grid').waitFor();
  assert.equal((await saveMass()).inventory[0].qty, 1);
  assert.deepEqual(errors, []);
  console.log('✓ 正式军团面板：随队物品排令不扣量→主任务执行→保存失败整轮撤回→重试恢复7/扣1→重开保持');
  console.log(process.argv.includes('--mass-only') ? '✓ 仅复查受军团新入口影响的物品尾段' : process.argv.includes('--skip-layout') ? '✓ 后续流程通过；沿用先前八组库存布局检查，本次未重复截图' : '✓ 库存正式面板：4宽度×双主题，无页面横溢出，触控至少44px，无页面错误');
} catch (error) {
  const frames = browser.contexts()[0]?.pages()[0]?.frames() ?? [];
  const frame = frames.find((f) => f.parentFrame());
  if (frame) console.error('失败时界面：', await frame.locator('body').innerText().then((text) => text.slice(-5000)).catch(() => '不可读'));
  throw error;
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
