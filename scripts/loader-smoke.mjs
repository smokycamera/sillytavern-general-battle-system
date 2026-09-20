/**
 * 加载器冒烟测试（真实浏览器，Playwright + 系统 Edge，无头）。
 *
 * 模拟酒馆环境验证 tavern-battle-script.json 的完整链路：
 *   宿主页 = 酒馆主窗口（window.TavernHelper mock + 事件总线）
 *   隐藏 iframe = 酒馆助手脚本 iframe（按 createSrcContent 的方式把 loader 内联进 <script type="module">）
 * 验证：浮动窗注入宿主 → 面板经 window.parent.TavernHelper 连上「酒馆」→
 *       关闭记忆 / 按钮开关 / 脚本停用清理 生命周期。
 *
 * 前置：npm run build:dist（产物 panel/dist/tavern-battle-script.json）
 */
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const WIN_ID = 'tavern-battle-panel-window';

const scriptPath = process.argv.find(arg => arg.startsWith('--script='))?.slice('--script='.length) ?? 'panel/dist/tavern-battle-script.json';
const scriptJson = JSON.parse(readFileSync(path.resolve(scriptPath), 'utf8'));
const loader = scriptJson.content;
const tailFixture = process.argv.includes('--tail-only') ? JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/p4-loader-tail-fixture.ts'], { encoding: 'utf8' })) : null;
const BTN_EVENT = 'button:' + scriptJson.button.buttons[0].name;

const failures = [];
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name} ${extra}`);
    failures.push(name);
  }
}

// ---------- 宿主页：酒馆主窗口 mock（对齐主窗口 TavernHelper 真实暴露面） ----------
const hostPage =
  '<!doctype html><html><head></head><body>' +
  '<div id="chat">酒馆聊天区</div>' +
  '<script>' +
  'window.__handlers = {};' +
  'window.eventOn = (name, cb) => { (window.__handlers[name] = window.__handlers[name] || []).push(cb); };' +
  'window.fire = (name, ...args) => (window.__handlers[name] || []).forEach(cb => cb(...args));' +
'const vars = { chat: {}, character: {} };' +
'window.__injections = [];' + // 记录 setExtensionPrompt 调用（id+content）——真实酒馆注入路径
'window.__cards = [];' +     // 记录 createChatMessages 调用
'window.__userSends = [];' + // 记录 sendMessageAsUser 调用（结算卡/状态摘要 user 楼层发送）
'window.__nativeChat = []; window.__chatId = "loader-test";' +
'window.SillyTavern = { getContext: () => ({ chatId: window.__chatId, characterId: 0, characters: [{avatar:"test.png"}], chat: window.__nativeChat, setExtensionPrompt: (id, content) => { window.__injections.push({ id, content }); } }) };' +
  'const messageStore = [' + // 静态消息：待审队列扫描用（T8 用 __setLastMessage 覆盖，容忍换行差异）
  '  { role: "assistant", message: "旧消息" },' +
  '  { role: "assistant", message: "最新一条 AI 回复，无标签" }' +
  '];' +
  'window.__setLastMessage = (msg, append=false) => { if(append)messageStore.push({}); const id=messageStore.length-1; messageStore[id] = { role: "assistant", message: msg, message_id: id, swipe_id: 0, swipes: [msg] }; window.__nativeChat[id] = {gen_finished:"2026-09-05",swipe_id:0}; return id; };' +
  'window.TavernHelper = {' +
  '  getVariables: ({ type = "chat" }) => vars[type],' +
  '  setVariables: ({ type = "chat", ...kv }) => Object.assign(vars[type], kv),' +
  '  tavern_events: { MESSAGE_RECEIVED: "message_received", MESSAGE_SENT: "message_sent", CHAT_CHANGED: "chat_id_changed", GENERATION_AFTER_COMMANDS: "before_generation", GENERATION_ENDED: "generation_ended", GENERATION_STOPPED: "generation_stopped" },' +
  '  getChatMessages: (range) => { if (range === -1) return [messageStore[messageStore.length - 1]]; return Array.isArray(range) ? messageStore.slice(range[0], range[1] + 1) : messageStore; },' +
'  injectPrompts: (prompts) => { window.__injections.push(...prompts); return { uninject: () => {} }; },' +
'  uninjectPrompts: (ids) => { ids.forEach(id => { window.__injections = window.__injections.filter(p => p.id !== id); }); },' +
'  createChatMessages: (msgs) => { window.__cards.push(...msgs); },' +
'  sendMessageAsUser: (text) => { window.__userSends.push(text); return Promise.resolve(true); },' +
  '  _bind: { _eventOn: (ev, cb) => { (window.__handlers[ev] = window.__handlers[ev] || []).push(cb); return { stop: () => {} }; } }' +
  '};' +
  '</script>' +
  '</body></html>';

// ---------- 脚本 iframe：按酒馆助手 createSrcContent 的方式内联 loader ----------
const scriptIframeHtml =
  '<!doctype html><html><head>' +
  '<script>' + // 模拟酒馆助手 predefine 提供的脚本内全局
  'window.eventOn = parent.eventOn;' +
  'window.getButtonEvent = (name) => "button:" + name;' +
  '</script>' +
  '</head><body>' +
  '<script type="module">' + '\n' + loader + '\n' + '</script>' +
  '</body></html>';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => failures.push(`页面异常: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') failures.push(`console.error: ${m.text()}`);
});

// 本地 HTTP 宿主（真实酒馆即 http 源；about:blank 的不透明源会让 sessionStorage 拒绝访问）
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(hostPage);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// 避开 Chromium 封禁端口（如 10080），撞上就换
while (server.address().port === 10080) {
  server.close();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
}
const port = server.address().port;
mkdirSync('panel/smoke-shots', { recursive: true });
try {
await page.goto(`http://127.0.0.1:${port}/`);

if (!process.argv.includes('--workflow-only') && !tailFixture) {
console.log('T1 启动即自动打开浮动窗');
await page.evaluate((html) => {
  const f = document.createElement('iframe'); // 酒馆助手脚本 iframe（隐藏）
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await page.waitForSelector('#' + WIN_ID, { timeout: 5000 });
check('浮动窗注入酒馆主界面', (await page.locator('#' + WIN_ID).count()) === 1);
check('注入配套样式表', (await page.locator('#tavern-battle-panel-style').count()) === 1);
await page.screenshot({ path: 'panel/smoke-shots/lv1_自动打开.png' });

console.log('T2 面板在 srcdoc iframe 中启动并连上「酒馆」');
const panel = page.frameLocator('#' + WIN_ID + ' iframe');
await panel.locator('h1').waitFor({ timeout: 8000 });
const h1 = await panel.locator('h1').textContent();
check('面板启动（标题渲染）', /战阵/.test(h1 || ''), `h1="${h1}"`);
await panel.locator('.workspace-nav [data-tab="settings"]').click();
check('经 window.parent.TavernHelper 识别为酒馆助手环境', /酒馆助手/.test(await panel.locator('.workspace-diagnostics').textContent()));
await panel.locator('.workspace-nav [data-tab="units"]').click();
const genOk = await (async () => {
  await panel.locator('[data-action="gen-toggle"]').click(); // 展开造怪器二阶面板
  await panel.locator('[data-role="gen-name"]').first().fill('冒烟兵');
  await panel.locator('[data-action="gen-add"]').click();
  await panel.locator('[data-action="builder-confirm"]').click();
  return (await panel.locator('.unit').count()) === 1;
})();
check('面板内可生成编制（引擎可用）', genOk);

console.log('T3 关闭 → 记忆本会话；按钮事件 → 重开');
await page.locator('#' + WIN_ID + ' .tb-x').click();
await page.waitForTimeout(100);
check('✕ 关闭后窗口移除', (await page.locator('#' + WIN_ID).count()) === 0);
check('关闭状态写入 sessionStorage', (await page.evaluate(() => sessionStorage.getItem('tavern-battle-panel:manually-closed'))) === '1');
check('窗口关闭后悬浮球出现', await page.locator('#tavern-battle-panel-ball').isVisible());
await page.evaluate((ev) => window.fire(ev), BTN_EVENT);
await page.waitForSelector('#' + WIN_ID, { timeout: 3000 });
check('脚本按钮事件重开窗口', (await page.locator('#' + WIN_ID).count()) === 1);
check('重开后清除关闭标记', (await page.evaluate(() => sessionStorage.getItem('tavern-battle-panel:manually-closed'))) === null);
check('窗口打开时悬浮球隐藏', !(await page.locator('#tavern-battle-panel-ball').isVisible()));
await panel.locator('h1').waitFor({ timeout: 8000 });
check('重开后面板重新渲染', /战阵/.test((await panel.locator('h1').textContent()) || ''));

console.log('T4 手动关闭后，脚本重载不强开');
await page.locator('#' + WIN_ID + ' .tb-x').click();
await page.waitForTimeout(50);
await page.evaluate(() => document.getElementById('TH-script--tavern-battle')?.remove());
await page.evaluate((html) => {
  const f = document.createElement('iframe');
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await page.waitForTimeout(400);
check('手动关闭过的会话内，脚本重载不自动弹出', (await page.locator('#' + WIN_ID).count()) === 0);

console.log('T5 脚本停用（iframe 移除）→ 清理注入的 DOM');
await page.evaluate((ev) => window.fire(ev), BTN_EVENT); // 先打开，再测清理
await page.waitForSelector('#' + WIN_ID, { timeout: 3000 });
await page.evaluate(() => document.getElementById('TH-script--tavern-battle')?.remove());
await page.waitForTimeout(400);
check('脚本停用后浮动窗被清理', (await page.locator('#' + WIN_ID).count()) === 0);
check('脚本停用后悬浮球被清理', (await page.locator('#tavern-battle-panel-ball').count()) === 0);
check('脚本停用后样式表被清理', (await page.locator('#tavern-battle-panel-style').count()) === 0);

console.log('T6 悬浮球：点按开关、拖动换位且持久化');
await page.evaluate((html) => {
  const f = document.createElement('iframe');
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await page.waitForSelector('#' + WIN_ID, { timeout: 3000 });
check('桌面端脚本重载后自动开窗', (await page.locator('#' + WIN_ID).count()) === 1);
await page.locator('#' + WIN_ID + ' .tb-x').click(); // 收回为球
await page.waitForTimeout(100);
const ball = page.locator('#tavern-battle-panel-ball');
check('窗口关闭后悬浮球出现', await ball.isVisible());
const before = await ball.boundingBox();
await page.mouse.move(before.x + 22, before.y + 22);
await page.mouse.down();
await page.mouse.move(before.x + 122, before.y + 82, { steps: 8 }); // 拖过 8px 阈值
await page.mouse.up();
await page.waitForTimeout(100);
const after = await ball.boundingBox();
check('拖动后悬浮球移位且面板未打开', after.x !== before.x && (await page.locator('#' + WIN_ID).count()) === 0);
const saved = await page.evaluate(() => localStorage.getItem('tavern-battle-panel:ball-pos'));
check('球位置写入 localStorage', !!saved && Number.isFinite(JSON.parse(saved).left));
await ball.click(); // 点按（无位移）
await page.waitForSelector('#' + WIN_ID, { timeout: 3000 });
check('点按悬浮球打开面板', (await page.locator('#' + WIN_ID).count()) === 1);
check('窗口打开时悬浮球隐藏', !(await ball.isVisible()));
// 脚本重载走恢复路径：清理后重建，球应回到持久化位置
await page.evaluate(() => document.getElementById('TH-script--tavern-battle')?.remove());
await page.waitForTimeout(200);
await page.evaluate((html) => {
  const f = document.createElement('iframe');
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await page.waitForSelector('#tavern-battle-panel-ball', { state: 'attached', timeout: 3000 });
await page.waitForSelector('#' + WIN_ID, { timeout: 3000 }); // 桌面重载会自动开窗（球随即隐藏）
const restored = await page.evaluate(() => {
  const b = document.getElementById('tavern-battle-panel-ball');
  b.style.display = 'flex'; // 开窗后球被隐藏，先恢复显示才能量到几何位置
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
check('脚本重载后球恢复到持久化位置', Math.abs(restored.x - after.x) < 2 && Math.abs(restored.y - after.y) < 2);

await page.close();
console.log('T7 手机视口：不自动弹窗，悬浮球入口，全屏面板');
const mpage = await browser.newPage({ viewport: { width: 390, height: 844 } });
mpage.on('pageerror', (e) => failures.push(`手机页异常: ${e.message}`));
await mpage.goto(`http://127.0.0.1:${port}/`);
await mpage.evaluate((html) => {
  const f = document.createElement('iframe');
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await mpage.waitForSelector('#tavern-battle-panel-ball', { timeout: 3000 });
check('手机端不自动弹窗', (await mpage.locator('#' + WIN_ID).count()) === 0);
const mball = await mpage.locator('#tavern-battle-panel-ball').boundingBox();
check('手机端悬浮球在界内', mball.x >= 0 && mball.y >= 0 && mball.x + mball.width <= 390 && mball.y + mball.height <= 844);
await mpage.locator('#tavern-battle-panel-ball').click();
await mpage.waitForSelector('#' + WIN_ID, { timeout: 3000 });
const mwin = await mpage.locator('#' + WIN_ID).boundingBox();
check('点球后面板全屏（≈视口尺寸、贴边）', Math.abs(mwin.width - 390) < 2 && Math.abs(mwin.height - 844) < 2 && mwin.x === 0 && mwin.y === 0, JSON.stringify(mwin));
const mpanel = mpage.frameLocator('#' + WIN_ID + ' iframe');
await mpanel.locator('h1').waitFor({ timeout: 8000 });
check('手机全屏内面板启动', /战阵/.test((await mpanel.locator('h1').textContent()) || ''));
const mobileHint = await mpage.locator('#' + WIN_ID + ' .tb-hint').textContent();
check('手机端提示为收起话术', /收起为悬浮球/.test(mobileHint || ''), `hint="${mobileHint}"`);
await mpage.locator('#' + WIN_ID + ' .tb-x').click();
await mpage.waitForTimeout(100);
check('手机端 ✕ 收回悬浮球', (await mpage.locator('#' + WIN_ID).count()) === 0 && (await mpage.locator('#tavern-battle-panel-ball').isVisible()));
await mpage.close();

} else { await page.close(); }
if (!process.argv.includes('--wrapper-only')) {
// ---------- 独立 page：自动扫描、新建与注入，关闭上一页后串行运行 ----------
const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page2.on('pageerror', (e) => failures.push(`页面2异常: ${e.message}`));
page2.on('console', (m) => { if (m.type() === 'error') failures.push(`console.error: ${m.text()}`); });
await page2.goto(`http://127.0.0.1:${port}/`);
if (tailFixture) await page2.evaluate((panel) => window.TavernHelper.setVariables({ type: 'chat', panel }), tailFixture);
await page2.evaluate((html) => {
  const f = document.createElement('iframe');
  f.id = 'TH-script--tavern-battle';
  f.style.display = 'none';
  f.srcdoc = html;
  document.body.appendChild(f);
}, scriptIframeHtml);
await page2.waitForSelector('#' + WIN_ID, { timeout: 5000 });
const dpanel = page2.frameLocator('#' + WIN_ID + ' iframe');
page2.setDefaultTimeout(10000);
const go = (tab) => dpanel.locator('.workspace-nav [data-tab="' + tab + '"]').click();
const reveal = async (locator) => {
  for (const detail of await locator.locator('xpath=ancestor::details').all())
    if (!await detail.evaluate((e) => e.open)) await detail.locator('summary').first().click();
};
const scan = async () => { const button = dpanel.locator('[data-action="narrative-scan"]'); await reveal(button); await button.click(); };
const ensureBuilder = async () => { await go('units'); if (!await dpanel.locator('.gen-body').count()) await dpanel.locator('[data-action="gen-toggle"]').click(); };
const add = async () => {
  await dpanel.locator('[data-action="gen-add"]').click();
  await dpanel.locator('[data-action="builder-confirm"]').click();
  await ensureBuilder();
};
const chooseProtagonist = async (button) => {
  await reveal(button);
  if (!/当前主控/.test(await button.textContent())) await button.click();
};
const battleStart = async () => { await go('battle'); await dpanel.locator('[data-action="small-start"]').click(); };
const sendReport = async (action) => { await go('reports'); const button = dpanel.locator('[data-action="' + action + '"]'); await reveal(button); await button.click(); };

await dpanel.locator('h1').waitFor({ timeout: 8000 }); await go('units');

if (!tailFixture) {
console.log('T8 完整消息按原子批次进入待审，重复扫描不新增');
await page2.evaluate(() => {
  window.fire('before_generation', 'normal', {}, false);
  window.__setLastMessage('<tb>\n<give item="生锈的军刀" note="敌兵遗落"/>\n<spawn side="ally" scale="hero" name="旅人艾莉" archetype="ranged" level="4" traits="射击专家"/>\n<spawn side="enemy" scale="hero" name="黑铁亲卫" archetype="infantry" level="6" traits="重甲,狂暴"/>\n</tb>');
  window.fire('message_received', 1, 'normal');
  window.fire('generation_ended', 1);
});
await dpanel.locator('[data-action="narrative-approve"]').waitFor({ timeout: 5000 });
check('整条回复进入一个待审批次', (await dpanel.locator('[data-action="narrative-approve"]').count()) === 1);
await scan();
check('手动重扫不新增批次', (await dpanel.locator('[data-action="narrative-approve"]').count()) === 1);

console.log('T8b 整批批准后同时建档同伴、敌方与物品');
await dpanel.locator('[data-action="narrative-approve"]').click();
check('side=ally 的新单位保持我方', await dpanel.locator('.unit.ally').filter({ hasText: '旅人艾莉' }).count() === 1);
check('side=enemy 的新单位保持敌方', await dpanel.locator('.unit.enemy').filter({ hasText: '黑铁亲卫' }).count() === 1);
await go('inventory'); // 隐藏工作区按需渲染，先打开配装页再检查库存。
const storyItem = dpanel.locator('#inventory-panel .inventory-card').filter({ hasText: '生锈的军刀' });
check('同批物品入库且无规格不伪造使用效果', await storyItem.count() === 1 && await storyItem.locator('[data-action="inventory-use"]').count() === 0);
await go('units');

console.log('T8c 已提交消息重扫不重复建档');
const unitCountAfterApprove = await dpanel.locator('.unit').count();
await page2.evaluate(() => window.fire('generation_ended', 1));
await scan();
check('已批准批次不再次待审', await dpanel.locator('[data-action="narrative-approve"]').count() === 0);
check('单位数量保持不变', await dpanel.locator('.unit').count() === unitCountAfterApprove);

console.log('T8d 关闭面板后仍能注入、补员与部署，重开只恢复视图');
await reveal(dpanel.locator('[data-role="story-sync"]')); await dpanel.locator('[data-role="story-sync"]').check();
await page2.locator('#' + WIN_ID + ' .tb-x').click();
await page2.evaluate(() => {
  const record = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉');
  window.fire('before_generation', 'continue', {}, false);
  const id = window.__setLastMessage('<tb><unit_update id="' + record.id + '" hp="1"/><deploy id="' + record.id + '"/></tb>', true);
  window.fire('message_received', id, 'continue');
  window.fire('generation_ended', id);
});
await page2.waitForFunction(() => window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉').hp === 1);
check('关闭面板仍完成合法档案同步', await page2.locator('#' + WIN_ID).count() === 0);
await page2.locator('#tavern-battle-panel-ball').click();
await dpanel.locator('h1').waitFor(); await go('units');
check('重开后使用最新档案且不重复建档', await dpanel.locator('.unit').count() === unitCountAfterApprove);
check('常驻投影含最新生命', await page2.evaluate(() => window.__injections.some((p) => /"hp":1[,}]/.test(p.content ?? ''))));

console.log('T8e 正文明确祝福：待审→生效/注入→重扫不续期→关闭重开→撤销来源');
const blessedUnitId = await page2.evaluate(() => {
  const record = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉');
  window.fire('before_generation', 'normal', {}, false);
  const id = window.__setLastMessage('<tb><bless id="' + record.id + '" name="军神庇佑" traits="守护" battles="2"/></tb>', true);
  window.fire('message_received', id, 'normal'); window.fire('generation_ended', id); return record.id;
});
await dpanel.locator('[data-action="narrative-approve"]').waitFor();
check('已开剧情同步也不会自动授予祝福', await page2.evaluate(() => !window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉').snapshot.traitSources?.length));
await dpanel.locator('[data-action="narrative-approve"]').click();
const beforeDetail = await page2.evaluate(() => JSON.stringify(window.TavernHelper.getVariables({ type: 'chat' }).panel));
await dpanel.locator(`[data-action="unit-detail"][data-id="${blessedUnitId}"]`).click();
check('展开单位详情不保存或改变事实', await page2.evaluate((before) => JSON.stringify(window.TavernHelper.getVariables({ type: 'chat' }).panel) === before, beforeDetail));
check('正式详情显示来源与剩余场次', /军神庇佑.*剩余2场战斗/s.test(await dpanel.locator('[data-role="trait-sources"]').innerText()));
check('祝福以纯文字机制名进入常驻事实投影', await page2.evaluate(() => window.__injections.some((p) => /"effects"/.test(p.content) && /军神庇佑/.test(p.content) && /"traits":\["守护"\]/.test(p.content))));
await scan();
await page2.locator('#' + WIN_ID + ' .tb-x').click(); await page2.evaluate((ev) => window.fire(ev), BTN_EVENT); await dpanel.locator('h1').waitFor(); await go('units');
await dpanel.locator(`[data-action="unit-detail"][data-id="${blessedUnitId}"]`).click();
check('重扫/重开保留一个来源和原期限', await page2.evaluate(() => { const s = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉').snapshot.traitSources; return s.length === 1 && s[0].remaining === 2; }));
await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
await page2.screenshot({ path: 'panel/smoke-shots/trait-source-desktop.png' });
await page2.setViewportSize({ width: 390, height: 844 });
await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
await page2.screenshot({ path: 'panel/smoke-shots/trait-source-390.png' });
check('手机祝福详情不横溢出，撤销按钮可触控', await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => document.documentElement.scrollWidth <= innerWidth + 1 && e.querySelector('button').getBoundingClientRect().height >= 44));
await page2.setViewportSize({ width: 1200, height: 900 });
await dpanel.locator('[data-action="trait-source-revoke"]').click();
check('撤销只终止该来源，永久特质保留', await page2.evaluate(() => { const r = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉'); return r.snapshot.traitSources[0].revoked && r.traits.includes('sharpshooter') && !r.traits.includes('guardian'); }));

console.log('T8f 通用负面效果：正文审查→数值说明/剩余期限→重开不续期→解除');
await page2.evaluate((unitId) => {
  window.fire('before_generation', 'normal', {}, false);
  const id = window.__setLastMessage('<tb><affect id="' + unitId + '" name="神罚" effects="诅咒,士气低下" battles="2"/></tb>', true);
  window.fire('message_received', id, 'normal'); window.fire('generation_ended', id);
}, blessedUnitId);
await dpanel.locator('[data-action="narrative-approve"]').waitFor();
check('负面效果仍经整批审查', await page2.evaluate(() => !window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉').snapshot.traitSources.some((s) => s.kind === 'effect')));
await dpanel.locator('[data-action="narrative-approve"]').click();
if (!(await dpanel.locator('[data-role="trait-sources"]').count())) await dpanel.locator(`[data-action="unit-detail"][data-id="${blessedUnitId}"]`).click();
check('效果详情显示实际惩罚和期限', /神罚.*剩余2场战斗.*诅咒.*攻击和防御各降低2.*士气低下.*有效士气降低15/s.test(await dpanel.locator('[data-role="trait-sources"]').innerText()));
check('状态和来源进入正文投影', await page2.evaluate(() => window.__injections.some((p) => /"name":"神罚"/.test(p.content) && /"effects":\["诅咒","士气低下"\]/.test(p.content))));
await scan();
await page2.locator('#' + WIN_ID + ' .tb-x').click(); await page2.evaluate((ev) => window.fire(ev), BTN_EVENT); await dpanel.locator('h1').waitFor(); await go('units');
await dpanel.locator(`[data-action="unit-detail"][data-id="${blessedUnitId}"]`).click();
check('状态重扫重开不重复或续期', await page2.evaluate(() => { const s = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉').snapshot.traitSources.filter((s) => s.kind === 'effect'); return s.length === 1 && s[0].remaining === 2; }));
await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
await page2.screenshot({ path: 'panel/smoke-shots/effect-source-desktop.png' });
await page2.setViewportSize({ width: 390, height: 844 });
await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
await page2.screenshot({ path: 'panel/smoke-shots/effect-source-390.png' });
check('390px状态说明不横溢出，解除可触控', await dpanel.locator('[data-role="trait-sources"]').evaluate((e) => document.documentElement.scrollWidth <= innerWidth + 1 && e.querySelector('button').getBoundingClientRect().height >= 44));
await dpanel.locator('[data-action="trait-source-revoke"]').click();
check('解除保留原来源记录与永久能力', await page2.evaluate(() => { const r = window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.name === '旅人艾莉'); return r.snapshot.traitSources.every((s) => s.revoked) && r.traits.includes('sharpshooter'); }));
await page2.setViewportSize({ width: 1200, height: 900 });

console.log('T8g 学习短事件：整批审查→新增能力→原装备/生命不变→重扫/重开不重学');
const preLearn = await page2.evaluate((id) => structuredClone(window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.id === id)), blessedUnitId);
await page2.evaluate((unitId) => {
  window.fire('before_generation', 'normal', {}, false);
  const id = window.__setLastMessage('<tb><learn id="' + unitId + '" skills="束缚术L6"/></tb>', true);
  window.fire('message_received', id, 'normal'); window.fire('generation_ended', id);
}, blessedUnitId);
await dpanel.locator('[data-action="narrative-approve"]').waitFor();
check('正式审查说明新增学习', /学习|束缚术/.test(await dpanel.locator('body').innerText()));
await dpanel.locator('[data-action="narrative-approve"]').click();
const learned = await page2.evaluate((id) => window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.id === id), blessedUnitId);
check('新控制技能真实写入档案', learned.snapshot.abilities.some((a) => a.definitionId === 'bp-binding' && a.effects.some((e) => e.op === 'condition' && e.conditionId === 'restrained')));
check('学习不改生命和冻结装备', learned.hp === preLearn.hp && JSON.stringify(learned.snapshot.weapon) === JSON.stringify(preLearn.snapshot.weapon));
await scan();
await page2.locator('#' + WIN_ID + ' .tb-x').click(); await page2.evaluate((ev) => window.fire(ev), BTN_EVENT); await dpanel.locator('h1').waitFor(); await go('units');
check('学习重扫/重开不重复或重编译', await page2.evaluate(({ id, abilities }) => JSON.stringify(window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.find((r) => r.id === id).snapshot.abilities) === JSON.stringify(abilities), { id: blessedUnitId, abilities: learned.snapshot.abilities }));

console.log('T9 新建单位：默认收起，预览确认后入列');
await page2.evaluate(() => {
  window.fire('before_generation', 'normal', {}, false);
  const id = window.__setLastMessage('<tb><field env="forest" light="night"/></tb>', true);
  window.fire('message_received', id, 'normal'); window.fire('generation_ended', id);
});
await dpanel.locator('[data-action="narrative-approve"]').waitFor(); await dpanel.locator('[data-action="narrative-approve"]').click();
check('正文一个事件同时保存森林与夜间', await page2.evaluate(() => { const p = window.TavernHelper.getVariables({ type: 'chat' }).panel; return p.field === 'forest' && p.lighting === 'night'; }));
check('环境进入常驻正文事实', await page2.evaluate(() => window.__injections.some((p) => /环境：forest\/night/.test(p.content))));
// 后续战果用例仍使用原白天场景，以隔离加载/存档行为。
await page2.evaluate(() => {
  window.fire('before_generation', 'normal', {}, false);
  const id = window.__setLastMessage('<tb><field env="plains" light="day"/></tb>', true);
  window.fire('message_received', id, 'normal'); window.fire('generation_ended', id);
});
await dpanel.locator('[data-action="narrative-approve"]').waitFor(); await dpanel.locator('[data-action="narrative-approve"]').click();
const genDetails = dpanel.locator('.gen-details');
const isOpen0 = (await genDetails.locator('.gen-body').count()) === 1;
check('新建默认折叠', isOpen0 === false);
await dpanel.locator('[data-action="gen-toggle"]').click();
await page2.waitForTimeout(100);
const isOpen1 = (await genDetails.locator('.gen-body').count()) === 1;
check('点添加单位展开共用表单', isOpen1 === true);
check('实际特质标签均为纯文字且界面不再提供已删除分类', await dpanel.locator('body').evaluate((body) => !/杂兵/.test(body.innerText) && body.querySelectorAll('.builder-traits label').length > 0 && [...body.querySelectorAll('.builder-traits label')].every((label) => /^[\p{Script=Han}]+$/u.test(label.textContent.trim()))));
check('新建只提供个体/编队两种刻度', JSON.stringify(await dpanel.locator('[data-role="gen-scale"] option').evaluateAll((options) => options.map((o) => o.value))) === JSON.stringify(['hero', 'company']));
await dpanel.locator('[data-role="gen-name"]').fill('测试战士');
await dpanel.locator('[data-role="gen-side"]').selectOption('ally');

await dpanel.locator('[data-role="gen-scale"]').selectOption('hero');
await dpanel.locator('[data-role="gen-level"]').fill('3');
await add();
await dpanel.locator('[data-role="gen-name"]').fill('测试怪');
await dpanel.locator('[data-role="gen-side"]').selectOption('enemy');
await add();
await dpanel.locator('[data-role="gen-name"]').fill('测试怪2');
await dpanel.locator('[data-role="gen-side"]').selectOption('enemy');
await add();
check('折叠内生成 3 单位入列', (await dpanel.locator('.unit').count()) >= 3);

console.log('T10 战斗结束：不再自动注入；点「状态摘要/结算卡」以 user 楼层发给 AI');
// 清空编制，造恰 1 我方近战 + 1 敌方，避免多单位拉长战斗、绕开手动控制敌方的复杂度
await reveal(dpanel.locator('[data-action="gen-clear"]'));
await dpanel.locator('[data-action="gen-clear"]').click();
await page2.waitForTimeout(100);
// T9 结尾面板已展开（genOpen=true），gen-clear 不改展开态，直接填表单
await dpanel.locator('[data-role="gen-name"]').fill('御前剑士');
await dpanel.locator('[data-role="gen-side"]').selectOption('ally');

await dpanel.locator('[data-role="gen-scale"]').selectOption('hero');
await dpanel.locator('[data-role="gen-level"]').fill('3');
await add();
await dpanel.locator('[data-role="gen-name"]').fill('土匪');
await dpanel.locator('[data-role="gen-side"]').selectOption('enemy');
await add();
check('T10 编制为 1 我方 + 1 敌方', (await dpanel.locator('.unit').count()) === 2);
// 设我方英雄为主控：敌方始终自动，我方英雄留手动（自动行动=只代打非主控，主控停手）
await chooseProtagonist(dpanel.locator('.unit.ally').first().locator('[data-action="roster-proto"]'));
await page2.waitForTimeout(50);
await battleStart();
await reveal(dpanel.locator('[data-role="auto-turn"]')); await dpanel.locator('[data-role="auto-turn"]').check(); // 敌方自动，我方英雄手动结束回合即推进
for (let i = 0; i < 200 && (await dpanel.locator('.banner').count()) === 0; i++) {
  if (await dpanel.locator('[data-action="grid-auto"]').count()) { await dpanel.locator('[data-action="grid-auto"]').click(); continue; }
  const atk = await dpanel.locator('[data-action="small-attack"]').isEnabled();
  if (atk) {
    // 近战单位距目标≥1 时先前进再攻击（目标距离写在选项里）
    const opt = await dpanel.locator('[data-role="small-target"] option').first().textContent().catch(() => '');
    const dist = parseInt((opt.match(/距(\d+)/) || [0, '0'])[1] ?? '0', 10);
    if (dist > 0) {
      await dpanel.locator('[data-action="small-move"][data-dir="advance"]').click();
      await page2.waitForTimeout(30);
      if ((await dpanel.locator('.banner').count()) > 0) break;
    }
    await dpanel.locator('[data-role="small-target"]').selectOption({ index: 0 });
    await dpanel.locator('[data-action="small-attack"]').click();
  } else {
    await dpanel.locator('[data-action="small-endturn"]').click();
  }
  await page2.waitForTimeout(30);
}
await dpanel.locator('.banner').waitFor({ timeout: 8000 });
await page2.waitForTimeout(300);
// 战斗结束不再无感注入（旧 tavern-battle:state/:context 注入应不存在）
const injectionsAfterBattle = await page2.evaluate(() => window.__injections);
check('事实投影常驻，但战斗结束不自动发送聊天消息', injectionsAfterBattle.some((p) => p.id === 'tavern-battle:context') && (await page2.evaluate(() => window.__userSends.length)) === 0);
// 点「状态摘要 → 发给AI」：以 user 楼层发送（sendAsUser 是 async，轮询等待）
await sendReport('out-inject');
let sentSummary = '';
for (let t = 0; t < 20; t++) {
  sentSummary = (await page2.evaluate(() => window.__userSends)).find((s) => /战阵·(当前|会战)状态/.test(s)) ?? '';
  if (sentSummary) break;
  await page2.waitForTimeout(100);
}
check('状态摘要以 user 消息发送（含状态与配置的叙述提示）', /战阵·(当前|会战)状态/.test(sentSummary) && sentSummary.trimEnd().endsWith('根据战斗情况描写战斗过程，不得出现血量，骰子点数等词'), sentSummary.slice(-100));
// 战斗结束：用「收兵并清理战场」取代旧的「开始下一场就重开」——删覆没、清战斗态、存活写回档案
check('收兵归营按钮已移除', (await dpanel.locator('[data-action="small-end"]').count()) === 0);
check('战斗结束有「收兵并清理战场」按钮', (await dpanel.locator('[data-action="battle-close"]').count()) === 1);
await go('battle'); await dpanel.locator('[data-action="battle-close"]').click();
await ensureBuilder();
await page2.waitForTimeout(120);
check('收兵后回到无战斗态（「开始战斗」按钮出现）', (await dpanel.locator('[data-action="small-start"]').count()) === 1);
// 第一场任一方都可能获胜；按阵营补齐，确保第二场一定同时有我方和敌方。
if ((await dpanel.locator('.unit.ally').count()) === 0) {
  await dpanel.locator('[data-role="gen-name"]').fill('增援剑士');
  await dpanel.locator('[data-role="gen-side"]').selectOption('ally');
  await add();
  await page2.waitForTimeout(80);
}
if ((await dpanel.locator('.unit.enemy').count()) === 0) {
  await dpanel.locator('[data-role="gen-name"]').fill('土匪');
  await dpanel.locator('[data-role="gen-side"]').selectOption('enemy');
  await add();
  await page2.waitForTimeout(80);
}
// 直接开第二场（敌我已补齐）
// 上场主控可能阵亡；autoTurn 仍开启时，新主控未设置会让第二场在 render 内直接自动打完。
const secondProtagonist = dpanel.locator('.unit.ally').first().locator('[data-action="roster-proto"]');
await chooseProtagonist(secondProtagonist);
await battleStart();
await reveal(dpanel.locator('[data-role="auto-turn"]')); await dpanel.locator('[data-role="auto-turn"]').check();
for (let i = 0; i < 200 && (await dpanel.locator('.banner').count()) === 0; i++) {
  if (await dpanel.locator('[data-action="grid-auto"]').count()) { await dpanel.locator('[data-action="grid-auto"]').click(); continue; }
  const atk = await dpanel.locator('[data-action="small-attack"]').isEnabled();
  if (atk) {
    const opt = await dpanel.locator('[data-role="small-target"] option').first().textContent().catch(() => '');
    const dist = parseInt((opt.match(/距(\d+)/) || [0, '0'])[1] ?? '0', 10);
    if (dist > 0) {
      await dpanel.locator('[data-action="small-move"][data-dir="advance"]').click();
      await page2.waitForTimeout(30);
      if ((await dpanel.locator('.banner').count()) > 0) break;
    }
    await dpanel.locator('[data-role="small-target"]').selectOption({ index: 0 });
    await dpanel.locator('[data-action="small-attack"]').click();
  } else {
    await dpanel.locator('[data-action="small-endturn"]').click();
  }
  await page2.waitForTimeout(30);
}
await dpanel.locator('.banner').waitFor({ timeout: 8000 });
await page2.waitForTimeout(200);
// 点「结算卡 → 发给AI」：整场结算卡以 user 楼层发送
await sendReport('out-card');
let sentCard = '';
for (let t = 0; t < 20; t++) {
  sentCard = (await page2.evaluate(() => window.__userSends)).find((s) => /战斗结算·共\d+回合/.test(s)) ?? '';
  if (sentCard) break;
  await page2.waitForTimeout(100);
}
check('结算卡（整场）以 user 消息发送', /【战斗结算·共\d+回合】/.test(sentCard), sentCard.slice(0, 60));

}
console.log('T10c 角色状态：点按钮以 user 楼层发送；message_sent 静默注入编制储存器清单');
await page2.evaluate(() => window.fire('message_sent'));
await page2.waitForTimeout(300);
const injAfterSent = await page2.evaluate(() => window.__injections);
check('message_sent 触发编制储存器静默注入', injAfterSent.some((p) => p.id === 'tavern-battle:context' && /单位资料/.test(p.content ?? '')), JSON.stringify(injAfterSent.map((p) => p.id)));
// 战后先归档，再为缺失主控的队伍建立新主控，不依赖随机胜方。
await go('battle');
if (await dpanel.locator('[data-action="battle-close"]').count()) await dpanel.locator('[data-action="battle-close"]').click();
await go('units');
if (await dpanel.locator('[data-action="role-inject"]').count() === 0) {
  await ensureBuilder();
  await dpanel.locator('[data-role="gen-name"]').fill('战后联络员');
  await dpanel.locator('[data-role="gen-side"]').selectOption('ally');
  await dpanel.locator('[data-role="gen-scale"]').selectOption('hero');
  await add();
  await chooseProtagonist(dpanel.locator('.unit.ally').filter({ hasText: '战后联络员' }).locator('[data-action="roster-proto"]'));
}
await dpanel.locator('[data-action="role-inject"]').click();
let sentRole = '';
for (let t = 0; t < 20; t++) {
  sentRole = (await page2.evaluate(() => window.__userSends)).find((s) => /【战阵·角色状态】/.test(s)) ?? '';
  if (sentRole) break;
  await page2.waitForTimeout(100);
}
check('角色状态以 user 消息发送（含角色状态/战场存活单位）', /【战阵·角色状态】/.test(sentRole) && /战场存活单位/.test(sentRole), sentRole.slice(0, 60));
console.log('T11 历史战报只读，切聊天撤销旧生成确认意图');
await go('battle');
if (await dpanel.locator('[data-action="battle-close"]').count()) await dpanel.locator('[data-action="battle-close"]').click();
await go('reports');
const beforeReportView = await page2.evaluate(() => JSON.stringify(window.TavernHelper.getVariables({ type: 'chat' }).panel));
await dpanel.locator('[data-role="report-select"]').selectOption({ index: 0 });
check('切换历史战报不再次保存或结算', await page2.evaluate((before) => JSON.stringify(window.TavernHelper.getVariables({ type: 'chat' }).panel) === before, beforeReportView));
await ensureBuilder();
await dpanel.locator('[data-role="gen-name"]').fill('跨聊天未提交单位');
await dpanel.locator('[data-action="gen-add"]').click();
await dpanel.locator('[data-role="builder-preview"]').waitFor();
await page2.evaluate(() => {
  window.__chatId = 'loader-other-chat';
  window.TavernHelper.setVariables({ type: 'chat', panel: { schemaVersion: 2, factRevision: 1, storage: [], rosterIds: [], reports: [] } });
  window.fire('chat_id_changed');
});
await dpanel.locator('[data-role="builder-preview"]').waitFor({ state: 'detached' });
check('新聊天没有旧确认按钮，也没有跨聊天新建', await dpanel.locator('[data-action="builder-confirm"]').count() === 0 && await page2.evaluate(() => window.TavernHelper.getVariables({ type: 'chat' }).panel.storage.length === 0));
await page2.close();
}

} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }

console.log('');
if (failures.length) {
  console.error(`✗ 加载器冒烟测试失败 ${failures.length} 项: ${failures.join(' | ')}`);
  process.exit(1);
} else {
  console.log(process.argv.includes('--wrapper-only') ? '✓ 当前分发载入器外壳T1–T7通过；未重复已通过正文任务' : tailFixture ? '✓ 角色投递、历史战报只读与跨聊天意图清理T10c–T11通过；未重跑前段' : process.argv.includes('--workflow-only') ? '✓ 正文与新工作区任务T8–T11通过；未重复载入器外壳T1–T7' : '✓ 加载器冒烟测试全部通过（截图 panel/smoke-shots/lv1_自动打开.png）');
}
