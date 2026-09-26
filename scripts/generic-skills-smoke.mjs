import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const fromEdit = process.argv.includes('--from-edit');
const recordsOnly = process.argv.includes('--records-only');
const initial = fromEdit ? JSON.parse(readFileSync('artifacts/generic-skills-learned.json', 'utf8'))
  : JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/generic-skills-fixture.ts'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><script>
  const vars={panel:${JSON.stringify(initial)}}; const handlers={}; const messages=[],chat=[];
  window.eventOn=(name,fn)=>{(handlers[name]??=[]).push(fn)};
  window.fire=(name,...args)=>(handlers[name]??[]).forEach(fn=>fn(...args));
  window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:(value)=>Object.assign(vars,value),
    tavern_events:{GENERATION_AFTER_COMMANDS:'before',GENERATION_ENDED:'end',MESSAGE_RECEIVED:'received',CHAT_CHANGED:'changed'},
    getChatMessages:(range)=>range===-1?[messages.at(-1)]:messages,
    _bind:{_eventOn:(name,fn)=>{window.eventOn(name,fn);return{stop:()=>{handlers[name]=handlers[name].filter(f=>f!==fn)}}}}};
  window.prompts=[];window.SillyTavern={getContext:()=>({chatId:'generic-skills-test',characterId:0,characters:[{avatar:'test.png'}],chat,setExtensionPrompt:(...args)=>window.prompts.push(args)})};
  window.readPanel=()=>vars.panel;
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
  const p = page.frameLocator('#panel'), tab = (name) => p.locator('[data-action="workspace-tab"][data-tab="' + name + '"]').first().click();
  const reopen = async () => { await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); };
  await reopen(); await p.locator('.battle-preparation').waitFor();
  if (recordsOnly) {
    const openHistory = async () => { for (const id of ['narrative-settings', 'narrative-history']) {
      const section = p.locator('[data-detail-id="' + id + '"]');
      if (await section.count() && !await section.evaluate((el) => el.open)) await section.locator(':scope > summary').click();
    } };
    const block = '<tb><field env="forest"/></tb>';
    await page.evaluate((block) => window.generate('<think>思考区示例<tb><field env="mountain"/></tb></think>正文内容' + block), block);
    await tab('units'); await p.locator('[data-action="narrative-approve"]').waitFor();
    assert.equal((await page.evaluate(() => window.readPanel())).proposals[0].source.text, block);
    await p.locator('.narrative-proposal details > summary').click();
    assert.equal(await p.locator('.narrative-proposal pre').innerText(), block);
    await p.locator('[data-action="narrative-approve"]').click();
    await page.waitForFunction(() => window.readPanel().field === 'forest');
    await openHistory();
    await p.locator('.narrative-proposal [data-action="narrative-delete"]').click();
    await page.waitForFunction(() => window.readPanel().proposals.length === 0);
    await p.locator('[data-action="narrative-scan"]').click();
    await reopen(); await tab('units');
    const saved = await page.evaluate(() => window.readPanel());
    assert.equal(saved.field, 'forest'); assert.equal(saved.proposals.length, 0); assert.equal(saved.committedNarrativeSources.length, 1);
    await openHistory();
    mkdirSync('panel/smoke-shots', { recursive: true });
    await page.screenshot({ path: 'panel/smoke-shots/generic-skills-records-390.png' });
    assert.deepEqual(errors, []);
    console.log('✓ 正式面板：思考示例隔离→只展示事件块→确认→删除→重扫/重开无重复入账');
  } else {
  const original = structuredClone(initial.storage[0].snapshot.abilities[0]);
  if (!fromEdit) {
  await page.evaluate(() => window.generate('<tb><learn id="caster" skills="春风拂面:buff范围治疗L7"/></tb>'));
  await tab('units'); await p.locator('[data-action="narrative-approve"]').waitFor(); await p.locator('[data-action="narrative-approve"]').click();
  await page.waitForFunction(() => window.readPanel().storage[0].snapshot.abilities.length === 2);
  }
  let caster = (await page.evaluate(() => window.readPanel())).storage.find((r) => r.id === 'caster').snapshot;
  assert.deepEqual(caster.abilities[0], original);
  const heal = caster.abilities.find((a) => a.name === '春风拂面'); assert.equal(heal.recipe.category, 'buff'); assert.equal(heal.power, 7);
  assert.ok(caster.preparedAbilityIds.includes(heal.id));
  if (!fromEdit) assert.match(await page.evaluate(() => window.prompts.at(-1)[1]), /增益范围治疗/);
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/generic-skills-learned.json', JSON.stringify(await page.evaluate(() => window.readPanel())));
  await tab('units');
  if (!await p.locator('[data-action="storage-edit"][data-id="caster"]').count()) await p.locator('[data-action="manage-toggle"]').click();
  const editor = p.locator('[data-action="storage-edit"][data-id="caster"]');
  if (!await editor.isVisible()) {
    await editor.evaluate((el) => { for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
  }
  await editor.click(); await p.locator('[data-builder-form="edit"]').waitFor();
  await p.locator('[data-detail-id="edit-skills"] > summary').click();
  assert.equal(await p.locator('[data-role="edit-skill"]').nth(1).inputValue(), '增益范围治疗');
  await p.locator('[data-role="edit-skill-name"]').nth(1).fill('回春之风');
  await p.locator('[data-role="edit-skill-name"]').nth(1).blur();
  await p.locator('[data-action="storage-preview"]').click();
  assert.match(await p.locator('[data-role="builder-preview"]').innerText(), /增益范围治疗.*L7/);
  await p.locator('[data-action="builder-confirm"]').click();
  caster = (await page.evaluate(() => window.readPanel())).storage.find((r) => r.id === 'caster').snapshot;
  const renamed = caster.abilities.find((a) => a.id === heal.id);
  assert.equal(renamed.name, '回春之风');
  assert.deepEqual(renamed.recipe, heal.recipe);
  assert.equal(renamed.power, heal.power);
  assert.equal(renamed.effectVersion, 'skill-v4.1');
  assert.equal(renamed.cooldownGroup, 'skill-mechanism:' + heal.definitionId);
  assert.equal(renamed.effects.find(e => e.op === 'heal').amount, 1120);
  await tab('battle'); await p.locator('[data-action="small-start"]').click(); await p.locator('.grid-board').waitFor();
  const before = await page.evaluate(() => window.readPanel().battle.snap);
  assert.equal(before.turnOrder[before.turnIndex], 'caster');
  await p.locator('[data-action="grid-mode"]').filter({ hasText: '技能' }).click();
  await p.locator('[data-role="grid-mode"]').selectOption(heal.id);
  await p.locator('[data-role="grid-target"]').selectOption('friend');
  await p.locator('.command-finish [data-action="grid-execute"]').click();
  const after = await page.evaluate(() => window.readPanel().battle.snap);
  for (const id of ['caster', 'friend']) assert.ok(after.combatants.find((u) => u.id === id).hp > before.combatants.find((u) => u.id === id).hp);
  assert.equal(before.combatants.find((u) => u.id === 'caster').resources.SP - after.combatants.find((u) => u.id === 'caster').resources.SP, heal.cost.amount);
  await reopen(); await p.locator('.grid-board').waitFor();
  assert.deepEqual(await page.evaluate(() => window.readPanel().battle.snap), after);
  mkdirSync('panel/smoke-shots', { recursive: true });
  await page.screenshot({ path: 'panel/smoke-shots/generic-skills-390.png' });
  assert.deepEqual(errors, []);
  console.log('✓ 正文自定义名+通用机制+等级→学习/准备→旧实例保持→正式编辑改名与预览→真实两目标治疗/扣费→快照重开');
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
