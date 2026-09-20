import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><script>
  const vars={}, callbacks={};
  const text='<tb><spawn name="甲" side="ally" scale="hero" skills="无此技能"/><spawn name="乙" side="enemy" scale="hero"/></tb>';
  window.event_types=Object.fromEntries(['GENERATION_AFTER_COMMANDS','GENERATION_ENDED','MESSAGE_RECEIVED'].map(k=>[k,k]));
  window.eventSource={on:(k,f)=>(callbacks[k]??=new Set()).add(f),off:(k,f)=>callbacks[k]?.delete(f)};
  window.emit=(k,...args)=>{for(const f of callbacks[k]??[])f(...args)};
  window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:v=>Object.assign(vars,v),getChatMessages:()=>[{message_id:1,swipe_id:0,role:'assistant',swipes:[text]}]};
  window.SillyTavern={getContext:()=>({chatId:'roster-repair',characterId:0,characters:[{avatar:'test.png'}],chat:[{}, {gen_finished:'2026-09-07',swipe_id:0}]})};
  window.readSave=()=>vars.panel;
  window.loseRoster=()=>{vars.panel.rosterIds=[];localStorage.clear()};
  </script><iframe id="panel" style="position:fixed;inset:0;width:100%;height:100%"></iframe>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const load = async () => { await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); await page.frameLocator('#panel').locator('.app-header').waitFor(); await page.frameLocator('#panel').locator('.workspace-nav [data-tab="units"]').click(); await page.frameLocator('#panel').locator('[data-action="manage-toggle"]').evaluate((button) => { if (button.textContent === '展开') button.click(); }); };
  await load();
  await page.evaluate(() => { window.emit('GENERATION_AFTER_COMMANDS'); window.emit('MESSAGE_RECEIVED', 1); window.emit('GENERATION_ENDED', 1); });
  await page.waitForFunction(() => window.readSave()?.proposals?.some((p) => p.status === 'pending'));
  let panel = page.frameLocator('#panel');
  await panel.locator('[data-action="narrative-approve"]').evaluate((button) => button.click());
  await page.waitForFunction(() => window.readSave()?.rosterIds?.length === 2);
  assert.equal(await page.evaluate(() => window.readSave().schemaVersion), 2);
  await load(); panel = page.frameLocator('#panel');
  assert.equal(await panel.locator('[data-action="storage-into"]').filter({ hasText: '已参战' }).count(), 2);
  await page.evaluate(() => window.loseRoster()); await load(); panel = page.frameLocator('#panel');
  await panel.locator('[data-action="narrative-restore-roster"]').evaluate((button) => button.click());
  await page.waitForFunction(() => window.readSave()?.rosterIds?.length === 2);
  assert.equal(await page.evaluate(() => window.readSave().storage.length), 2);
  await panel.locator('[data-action="manage-toggle"]').evaluate((button) => { if (button.textContent === '展开') button.click(); });
  await panel.locator('[data-action="storage-del"]').first().evaluate((button) => button.click());
  await page.waitForFunction(() => window.readSave()?.storage?.length === 1);
  assert.equal(await page.evaluate(() => window.readSave().rosterIds.length), 1);
  assert.deepEqual(errors, []);
  console.log('PASS 空聊天正文确认→两单位入库并上场→重开保留→旧批次名单恢复不重复造人→直接删除成功；未知技能未阻断');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
