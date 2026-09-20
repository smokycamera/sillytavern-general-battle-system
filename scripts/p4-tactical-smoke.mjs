import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/p4-tactical-fixture.ts', '--json'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><body style="margin:0"></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 844 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.setDefaultTimeout(8000);
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(({ fixture, html }) => {
    const vars = { panel: fixture }; window.readSave = () => vars.panel; window.writes = 0;
    window.TavernHelper = { getVariables: () => vars, insertOrAssignVariables: (value) => { window.writes++; Object.assign(vars, value); } };
    window.SillyTavern = { getContext: () => ({ chatId: 'tactical-ui-test' }) };
    const frame = document.createElement('iframe'); frame.id = 'panel'; frame.style = 'position:fixed;inset:0;border:0;width:100%;height:100%'; frame.srcdoc = html; document.body.append(frame);
  }, { fixture, html });
  const p = page.frameLocator('#panel'); await p.locator('.grid-board').waitFor();
  const before = await page.evaluate(() => ({ save: JSON.stringify(window.readSave()), writes: window.writes }));
  await p.locator('.grid-cell[data-cell="24"]').click();
  assert.match(await p.locator('.map-inspector').innerText(), /连续守住2个完整回合/);
  await p.locator('.grid-cell[data-cell="31"]').click();
  assert.match(await p.locator('.penetration-preview').innerText(), /无法穿透/);
  assert.equal(await p.locator('.command-actor h3').innerText(), '前锋术士');
  await p.locator('.grid-cell[data-cell="29"]').click();
  assert.match(await p.locator('.map-inspector').innerText(), /地面不可通行/);
  assert.equal(await p.locator('.move-preview [data-action="grid-move"]').isDisabled(), true);
  await p.locator('.command-modes button').filter({ hasText: '技能' }).click();
  const fire = fixture.battle.snap.combatants.find((u) => u.id === 'a').abilities.find((a) => a.definitionId === 'bp-firestorm');
  const heal = fixture.battle.snap.combatants.find((u) => u.id === 'a').abilities.find((a) => a.definitionId === 'bp-mending');
  await p.locator('[data-role="grid-mode"]').selectOption(fire.id);
  await p.locator('.grid-cell[data-cell="31"]').click();
  assert.equal(await p.locator('.grid-cell.area-hit').count(), 2);
  assert.match(await p.locator('.area-preview').innerText(), /铁甲守卫、守点步兵/);
  assert.equal(await p.locator('.tactical-workspace').innerText().then((t) => t.includes('未发现的伏兵')), false);
  mkdirSync('panel/smoke-shots', { recursive: true });
  for (const [width, theme] of [[390, 'dark'], [1024, 'light']]) {
    await page.setViewportSize({ width, height: 844 });
    await p.locator('body').evaluate((el, theme) => { el.dataset.theme = theme; scrollTo(0, 0); }, theme);
    assert.ok(await p.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await p.locator('.command-modes button').evaluateAll((buttons) => buttons.every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)));
    await page.screenshot({ path: 'panel/smoke-shots/p4-tactical-map-' + width + '-' + theme + '.png' });
    await p.locator('.grid-command').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'panel/smoke-shots/p4-tactical-command-' + width + '-' + theme + '.png' });
  }
  if (process.argv.includes('--visual-only')) { assert.deepEqual(errors, []); console.log('✓ 更新后的逐目标范围预览与390深色/1024浅色画面通过；未重复治疗和保存流程'); }
  else {
  await p.locator('[data-role="grid-mode"]').selectOption(heal.id);
  await p.locator('.grid-cell[data-cell="44"]').click();
  assert.equal(await p.locator('[data-role="grid-target"]').inputValue(), 'c');
  assert.match(await p.locator('.action-preview').innerText(), /预计恢复/);
  assert.equal(await p.locator('.command-actor h3').innerText(), '前锋术士');
  assert.deepEqual(await page.evaluate(() => ({ save: JSON.stringify(window.readSave()), writes: window.writes })), before);
  await p.locator('.command-finish [data-action="grid-execute"]').click();
  const healed = await page.evaluate(() => window.readSave().battle.snap);
  assert.ok(healed.combatants.find((u) => u.id === 'c').hp > 40);
  assert.ok(healed.actedThisTurn.includes('a'));
  await p.locator('.command-modes button').filter({ hasText: '移动' }).click();
  await p.locator('.grid-cell[data-cell="44"]').click();
  assert.match(await p.locator('.move-preview').innerText(), /花费2移动/);
  await p.locator('.move-preview [data-action="grid-move"]').click();
  const moved = await page.evaluate(() => window.readSave().battle.snap);
  assert.equal(moved.combatants.find((u) => u.id === 'a').pos, 44);
  assert.equal(moved.movementSpent.find(([id]) => id === 'a')[1], 2);
  assert.deepEqual(errors, []);
  console.log('✓ 地形/任务点/目标/两对象范围/治疗友军纯查看零保存；确认治疗后移动到友方同格真实生效；390深色、1024浅色无溢出，触控≥44px');
  }
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
