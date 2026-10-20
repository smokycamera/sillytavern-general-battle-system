import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('release/native-candidate'), disk = new Map(), errors = [];
const fixture = `<!doctype html><script>
window.handlers=new Map();
window.context={characterId:'0',characters:[{avatar:'draft-fixture.png'}],chatId:'draft',chat:[],chatMetadata:{},extensionSettings:{},
eventTypes:{CHAT_CHANGED:'CHAT_CHANGED'},eventSource:{on(k,cb){const a=handlers.get(k)||new Set();a.add(cb);handlers.set(k,a)},removeListener(k,cb){handlers.get(k)?.delete(cb)}},
getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){},setExtensionPrompt(){},
async saveMetadata(){await fetch('/fixture/save',{method:'POST',body:JSON.stringify({metadata:context.chatMetadata,chat:context.chat})})}};
window.SillyTavern={getContext:()=>context};
import('/extension/index.js');
</script>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (req.url === '/api/users/me') { res.setHeader('Content-Type', 'application/json'); res.end('{"handle":"draft-smoke"}'); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString()); res.setHeader('Content-Type', 'application/json');
      if (req.url === '/fixture/save') { disk.set('draft', structuredClone(data)); res.end('{}'); return; }
      if (req.url === '/api/chats/get') { const save = disk.get('draft'); res.end(JSON.stringify([{ chat_metadata: save?.metadata ?? {} }, ...(save?.chat ?? [])])); return; }
    }
    const file = path.resolve(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/extension\//, ''));
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(readFileSync(file));
  } catch (error) { res.statusCode = 404; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.TB_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__tavernBattleNative?.service.status().phase === 'ready');
  const source = '<tb>\n<spawn name="折行定位" side="ally" scale="hero" weapon="' + '长名称'.repeat(400)
    + ':剑L5+3热能" armor="重甲L5-奥术" skills="治療Ｌ３,壞技能Ｌ９９,未&#x77e5;技能,未&#x77e5;技能"/>\n</tb>';
  const propose = text => page.evaluate(async text => {
    const service = window.__tavernBattleNative.service;
    await service.proposeAiScan(text, service.snapshot().factRevision ?? 0, service.inventoryContext());
    return service.snapshot().proposals.at(-1).id;
  }, text);
  const firstId = await propose(source);
  await page.locator('#tavern-battle-native-entry').click();
  const panel = page.frameLocator('#tavern-battle-native-panel iframe');
  await panel.locator('[data-action="workspace-tab"][data-tab="units"]').first().click();
  const proposal = panel.locator(`[data-proposal="${firstId}"]`), button = proposal.locator('[data-action="narrative-error"]');
  await proposal.locator('summary').filter({ hasText: '修正事件草稿' }).click();
  const draft = proposal.locator('[data-role="narrative-draft"]');
  const selected = () => draft.evaluate(el => ({ text: el.value.slice(el.selectionStart, el.selectionEnd), start: el.selectionStart, scroll: el.scrollTop }));
  await button.click(); const first = await selected();
  assert.equal(first.text, '壞技能Ｌ９９'); assert.ok(first.scroll > 500, '自动折行的长行应滚到实际选区');
  assert.match(await proposal.locator('[data-role="narrative-error-position"]').textContent(), /第2行、第\d+列/);
  const screenshot = path.resolve('artifacts/narrative-draft-smoke/wrapped-error.png'); mkdirSync(path.dirname(screenshot), { recursive: true });
  await draft.screenshot({ path: screenshot });
  await button.click(); const second = await selected();
  await button.click(); const third = await selected();
  assert.equal(second.text, '未&#x77e5;技能'); assert.equal(third.text, second.text); assert.ok(third.start > second.start);
  await button.click(); assert.equal((await selected()).start, first.start);
  await propose('<tb><add item="合法补给"/><unit_update id="u1" hp="10"/><unit_update id="u1" hp="20"/></tb>');
  await panel.locator('.narrative-proposal').nth(1).waitFor();
  assert.equal(await draft.evaluate(el => el === document.activeElement), true);
  assert.equal((await selected()).start, first.start); assert.equal((await selected()).scroll, first.scroll);
  const conflict = panel.locator('.narrative-proposal').first();
  await conflict.locator('summary').filter({ hasText: '修正事件草稿' }).click();
  await conflict.locator('[data-action="narrative-error"]').click();
  assert.equal(await conflict.locator('[data-role="narrative-draft"]').evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), 'hp="20"');
  await draft.fill(source + '\n'); await button.click(); assert.equal((await selected()).text, '壞技能Ｌ９９');
  assert.deepEqual(errors, []);
  console.log('PASS: 自动折行滚动、原文坏项与重复项循环、多草稿重绘、整批冲突定位、编辑后重置；截图 ' + screenshot);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
