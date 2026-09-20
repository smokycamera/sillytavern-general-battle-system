import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/grid-fixture.ts'], { encoding: 'utf8' })); fixture.battle = null;
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><body style="margin:0"></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.setDefaultTimeout(8000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ fixture, html }) => {
    const vars = { panel: fixture }; window.readSave = () => vars.panel;
    window.TavernHelper = { getVariables: () => vars, insertOrAssignVariables: (value) => { if (window.failSave) throw Error('mock save failure'); Object.assign(vars, value); } };
    window.SillyTavern = { getContext: () => ({ chatId: 'builder-mock' }) };
    const frame = document.createElement('iframe'); frame.id = 'panel'; frame.style = 'position:fixed;inset:0;border:0;width:100%;height:100%'; frame.srcdoc = html; document.body.append(frame);
  }, { fixture, html });
  const p = page.frameLocator('#panel'); await p.locator('.workspace-nav').waitFor();
  await p.locator('.workspace-nav [data-tab="units"]').click(); await p.locator('[data-action="gen-toggle"]').click();
  await p.locator('[data-role="gen-name"]').fill('车载试验编队'); await p.locator('[data-role="gen-scale"]').selectOption('company'); await p.locator('[data-role="gen-hpMax"]').fill('560');
  await p.locator('[data-detail-id="gen-body"] > summary').click(); await p.locator('[data-role="gen-body"]').selectOption('vehicle');
  await p.locator('[data-role="gen-primary-mechanism"]').selectOption('cannon'); await p.locator('[data-role="gen-primary-power"]').fill('7');
  await p.locator('[data-detail-id="gen-primary-advanced"] > summary').click();
  assert.equal(await p.locator('[data-role="gen-primary-body"]').inputValue(), 'vehicle'); await p.locator('[data-role="gen-primary-stabilized"]').check();
  await p.locator('[data-role="gen-sidearmEnabled"]').check(); await p.locator('[data-role="gen-sidearm-mechanism"]').selectOption('light-ranged');
  await p.locator('[data-detail-id="gen-armor-advanced"] > summary').click(); await p.locator('[data-role="gen-armor-profile"]').selectOption('thermal');
  await p.locator('[data-detail-id="gen-skills"] > summary').click(); await p.locator('[data-action="builder-skill-add"][data-builder="gen"]').click();
  const unchanged = await page.evaluate(() => JSON.stringify(window.readSave()));
  await p.locator('[data-action="gen-add"]').click(); await p.locator('[data-role="builder-preview"]').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(window.readSave())), unchanged);
  await p.locator('[data-action="gen-add"]').click(); assert.equal(await page.evaluate(() => JSON.stringify(window.readSave())), unchanged);
  mkdirSync('panel/smoke-shots', { recursive: true });
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 }); await p.locator('[data-role="builder-preview"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    assert.ok(await p.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `panel/smoke-shots/p4-builder-preview-${width}.png` });
  }
  if (!process.argv.includes('--visual-only')) {
  await p.locator('[data-action="builder-confirm"]').click();
  let record = await page.evaluate(() => window.readSave().storage.find((r) => r.name === '车载试验编队'));
  assert.ok(record); const id = record.id, frozen = record.snapshot.weapon;
  assert.equal(frozen.recipe.stabilized, true); assert.equal(record.snapshot.armor.recipe.protectionProfile, 'thermal'); assert.equal(record.snapshot.sidearm.recipe.mechanism, 'light-ranged'); assert.equal(record.base.hpMax, 560);
  console.log('✓ 正式新建：默认方案→明确车体/稳定/副武器/专项甲/技能→重复预览不建档→确认一次写入');
  await p.locator('[data-action="manage-toggle"]').click(); await p.locator(`[data-action="storage-edit"][data-id="${id}"]`).click();
  await p.locator('[data-role="edit-name"]').fill('补员后的炮组'); await p.locator('[data-role="edit-hp"]').fill('70');
  await p.locator('[data-action="storage-preview"]').click(); await p.locator('[data-role="builder-preview"]').waitFor();
  const beforeSave = await page.evaluate(() => JSON.stringify(window.readSave()));
  await p.locator('body').evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { if (window.parent.failSave) throw Error('mock quota'); return original.apply(this, args); }; });
  await page.evaluate(() => { window.failSave = true; }); await p.locator('[data-action="builder-confirm"]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.readSave())), beforeSave); assert.equal(await p.locator('[data-action="builder-confirm"]').isVisible(), true);
  await page.evaluate(() => { window.failSave = false; }); await p.locator('[data-action="builder-confirm"]').click();
  record = await page.evaluate((id) => window.readSave().storage.find((r) => r.id === id), id);
  assert.deepEqual(record.snapshot.weapon, frozen); assert.equal(record.hp, 70); assert.equal(record.base.hpMax, 560);
  console.log('✓ 正式编辑：同一表单预览70/560→双写失败保留原档与预览→直接重试，装备精确不变');
  await p.locator('.workspace-nav [data-tab="inventory"]').click(); await p.locator('[data-role="inventory-unit"]').selectOption(id);
  const item = await p.locator(`[data-inventory-id="${frozen.id}"]`).count() ? frozen.id : await page.evaluate((id) => window.readSave().inventory?.find((i) => i.equippedTo?.unitId === id && i.equippedTo.slot === 'primary')?.id, id);
  assert.ok(item); await p.locator(`[data-inventory-id="${item}"] [data-action="inventory-edit"]`).click();
  await p.locator('[data-detail-id="inventory-advanced"] > summary').click(); assert.equal(await p.locator('[data-role="inventory-stabilized"]').isChecked(), true);
  await p.locator('[data-role="inventory-enchantment"]').selectOption('arcane'); await p.locator('[data-action="inventory-preview-draft"]').click(); await p.locator('[data-action="inventory-confirm"]').click();
  record = await page.evaluate((id) => window.readSave().storage.find((r) => r.id === id), id);
  assert.equal(record.snapshot.weapon.recipe.stabilized, true); assert.equal(record.snapshot.weapon.channel, 'arcane'); assert.equal(record.snapshot.armor.recipe.protectionProfile, 'thermal'); assert.equal(record.hp, 70);
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator('.workspace-nav').waitFor();
  assert.equal(await page.evaluate((id) => window.readSave().storage.find((r) => r.id === id).snapshot.weapon.channel, id), 'arcane');
  console.log('✓ 正式配装：同套特殊字段保留稳定装置→附魔改造→其他甲型/人员保留→重开');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
