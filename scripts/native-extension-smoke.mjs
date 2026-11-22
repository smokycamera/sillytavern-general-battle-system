import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('release/native-candidate');
const metadataMode = process.env.TB_METADATA_MODE ?? 'metadata-only';
assert.ok(['metadata-only', 'legacy-full'].includes(metadataMode), 'Unknown metadata save mode');
const artifacts = path.resolve('artifacts/native-extension-smoke', metadataMode); mkdirSync(artifacts, { recursive: true });
const disk = new Map(); const results = []; const errors = [];
let jevDelay = 0; let jevRequests = 0;
const fixture = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><textarea id="send_textarea">未发送的玩家草稿 | /send {{macro}}</textarea><input id="pending-file" value="fixture-attachment.txt"><main id="chat"></main><script>
document.documentElement.lang = new URLSearchParams(location.search).get('lang') || document.documentElement.lang;
window.handlers = new Map(); window.__failure=false; window.__delay=0; window.__generations=0; window.__prompts={};window.__metadataSaves=0;window.__fullSaves=0;
window.persistFixture=async full=>{const snapshot={id:context.chatId,metadata:structuredClone(context.chatMetadata),...(full?{chat:structuredClone(context.chat)}:{})};if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));if(!window.__failure){const response=await fetch(full?'/fixture/save':'/fixture/metadata',{method:'POST',body:JSON.stringify(snapshot)});if(!response.ok)throw Error('Fixture save failed: '+response.status)}};
window.context={ characterId:'0', characters:[{avatar:'fixture.png',name:'Fixture'}],chatId:'a',name1:'Tester',chat:[],chatMetadata:{},extensionSettings:{tavernBattle:{language:localStorage.getItem('fixture-tb-language')}},
eventTypes:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SENT','USER_MESSAGE_RENDERED','CHAT_CHANGED'].map(x=>[x,x])),
eventSource:{on(k,cb){const a=handlers.get(k)||new Set();a.add(cb);handlers.set(k,a)},removeListener(k,cb){handlers.get(k)?.delete(cb)},async emit(k,...args){for(const cb of handlers.get(k)||[])await cb(...args)}},
getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){const language=this.extensionSettings.tavernBattle.language;if(language)localStorage.setItem('fixture-tb-language',language)},
async saveMetadata(){window.__metadataSaves++;await persistFixture(${metadataMode === 'legacy-full'})},
async saveChat(){window.__fullSaves++;await persistFixture(true)},
setExtensionPrompt(id,value){__prompts[id]=value},addOneMessage(message){const p=document.createElement('p');p.textContent=message.mes;document.getElementById('chat').append(p)},async generate(type,options){window.__generations++;window.__generationType=type;if(type==='normal'){document.getElementById('send_textarea').value='';document.getElementById('pending-file').value=''}await context.eventSource.emit('GENERATION_STARTED',type,options,false);await context.eventSource.emit('GENERATION_AFTER_COMMANDS',type,options,false);context.chat.push({is_user:false,mes:'合成宿主的完整叙述回复',swipe_id:0,gen_finished:'complete'});await context.saveChat();await context.eventSource.emit('MESSAGE_RECEIVED',context.chat.length-1);await context.eventSource.emit('GENERATION_ENDED',context.chat.length)}};
window.SillyTavern={getContext:()=>context};
window.switchChat=async id=>{const response=await fetch('/api/chats/get',{method:'POST',body:JSON.stringify({file_name:id})});const data=await response.json();context.chatId=id;context.chatMetadata=data[0]?.chat_metadata||{};context.chat=data.slice(1);await context.eventSource.emit('CHAT_CHANGED')};
awaitReady();async function awaitReady(){await switchChat('a');await import('/extension/index.js');}
</script></body></html>`;
const server = http.createServer(async (req,res) => {
  try {
    if (new URL(req.url,'http://localhost').pathname === '/') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return; }
    if (req.url === '/api/users/me') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({handle:'smoke-user'}));return; }
    if (req.method === 'POST') {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type','application/json');
      if(req.url==='/jev/api/bridge/evaluate') { jevRequests++; if(jevDelay) await new Promise(resolve=>setTimeout(resolve,jevDelay));res.end(JSON.stringify({model:'browser-test-jev',confidence:0.9,scores:Object.fromEntries(data.candidates.map(c=>[c.id,0.5]))}));return; }
      if(req.url==='/jev/api/bridge/select-context') {res.end(JSON.stringify({model:'browser-test-jev',selections:Object.fromEntries(data.fields.map(f=>[f.id,{value:Object.keys(f.options)[0],confidence:0}]))}));return;}
      if(req.url==='/jev/api/bridge/context') {res.end(JSON.stringify({goals:[],battleType:'skirmish'}));return;}
      if(req.url==='/fixture/save'){disk.set(data.id,structuredClone(data));res.end('{}');return;}
      if(req.url==='/fixture/metadata'){disk.set(data.id,{...(disk.get(data.id)??{chat:[]}),id:data.id,metadata:structuredClone(data.metadata)});res.end('{}');return;}
      if(req.url==='/api/chats/get'){const state=disk.get(data.file_name);res.end(JSON.stringify([{chat_metadata:state?.metadata??{}},...(state?.chat??[])]));return;}
    }
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/extension\//,'');
    const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))throw Error('Outside fixture');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(file));
  }catch(error){res.statusCode=404;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({...(process.env.TB_BROWSER?{executablePath:process.env.TB_BROWSER}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const jevNetwork=[];
page.on('requestfailed',request=>{if(request.url().includes('/api/bridge/'))jevNetwork.push({url:request.url(),error:request.failure()?.errorText});});
page.on('response',response=>{if(response.url().includes('/api/bridge/'))jevNetwork.push({url:response.url(),status:response.status()});});
page.on('pageerror',error=>errors.push(String(error)));
const check=(name,condition)=>{assert.ok(condition,name);results.push(name);console.log('PASS '+name)};
const ready=()=>page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='ready');
const state=()=>page.evaluate(()=>window.__tavernBattleNative.service.snapshot());
const idle=async frame=>frame.locator('body:not([aria-busy="true"])').waitFor();
try {
  await page.goto(url);await ready();
  check('启动无需助手且尚未创建面板',await page.evaluate(()=>!window.TavernHelper&&!document.querySelector('iframe')));
  check('纯档案初始化不触发完整聊天保存',await page.evaluate(()=>__metadataSaves>0&&__fullSaves===0));
  const entry = page.locator('#tavern-battle-native-entry');
  const entryBox = await entry.boundingBox();
  check('悬浮入口为圆形交叉剑',await entry.evaluate(el=>getComputedStyle(el).borderRadius==='50%'&&!!el.querySelector('svg')&&el.offsetWidth===el.offsetHeight));
  await page.mouse.move(entryBox.x+26,entryBox.y+26);await page.mouse.down();await page.mouse.move(entryBox.x-100,entryBox.y-90,{steps:8});await page.mouse.up();
  check('拖动不误开面板且保存位置',await page.evaluate(()=>document.getElementById('tavern-battle-native-panel').hidden&&Number.isFinite(context.extensionSettings.tavernBattle.entryPosition.left)));
  await page.locator('#tavern-battle-native-entry').click();
  const frame=page.frameLocator('#tavern-battle-native-panel iframe');await frame.locator('#app h1').waitFor();
  check('独立静态面板已加载',await frame.locator('[data-action="workspace-tab"]').count()>0);
  const languageButton = frame.locator('[data-action="language-toggle"]');
  check('语言入口在战阵开关左边', await languageButton.evaluate(button =>
    button.textContent === 'English' && button.nextElementSibling?.dataset.action === 'plugin-toggle'));
  await frame.locator('.workspace-nav [data-tab="settings"]').click();
  const llmSettingsCopy = () => frame.locator('.llm-settings').textContent();
  const settingsTextRemoved = async () => !/OpenAI 兼容接口|所选正文发送给该服务|6000|OpenAI-compatible connection|Settings save automatically/i.test(await llmSettingsCopy());
  check('中文版副 API 设置移除旧说明', await settingsTextRemoved());
  await frame.locator('[data-action="plugin-toggle"]').click();
  await frame.locator('[data-action="plugin-toggle"][aria-pressed="false"]').waitFor();
  await languageButton.click();
  check('关闭战阵时仍可切换英文', await languageButton.evaluate(button =>
    button.textContent === '简体中文' && document.documentElement.lang === 'en'));
  await frame.locator('[data-action="plugin-toggle"]').click();
  await frame.locator('[data-action="plugin-toggle"][aria-pressed="true"]').waitFor();
  await page.reload(); await ready(); await entry.click();
  check('刷新后保持英文并翻译外层浮窗和导航',
    await languageButton.innerText() === '简体中文' &&
    await page.getByRole('button', { name: 'Saves', exact: true }).count() === 1 &&
    await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').innerText() === 'Battle');
  await frame.locator('.workspace-nav [data-tab="settings"]').click();
  check('英文版副 API 设置移除旧说明并显示英文阵营选项', await settingsTextRemoved() &&
    /Command Enemies.*Command Third-Party Forces/s.test(await llmSettingsCopy()));
  check('英文设置显示发送范围与提示词编辑标签',
    await frame.locator('.prompt-scope h2').innerText() === 'Story Reference Scope' &&
    (await frame.locator('.prompt-scope p').first().innerText()).startsWith('Selected for context:') &&
    await frame.locator('[data-detail-id="prompt-editor-units"] summary').innerText() === 'Edit Prompt');
  check('英文设置显示四个世界书条目并注入英文正文',
    (await frame.locator('.worldbook-settings [data-worldbook-entry] strong').allTextContents()).join('|') ===
      'Battle Interaction and Reports|Equipment and Ability Power Reference|Units and Equipment|Skills and Effects' &&
    (await frame.locator('#wb-5-content').inputValue()).includes('from spacecraft to spacewalkers') &&
    await page.evaluate(() => Object.values(__prompts).some(text => text.includes('from spacecraft to spacewalkers'))));
  await page.setViewportSize({ width: 320, height: 680 });
  const outerPanel = page.locator('#tavern-battle-native-panel');
  await outerPanel.evaluate(panel => {
    for (const [edge, value] of Object.entries({ top: 48, right: 10, bottom: 15, left: 10 })) {
      panel.style.setProperty(`--tb-safe-${edge}`, `${value}px`);
    }
  });
  const buttons = await frame.locator('.app-controls button').evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect();
    return { top: box.top, left: box.left, right: box.right, width: el.ownerDocument.documentElement.clientWidth };
  }));
  check('320px宽度下三个按钮都在同一行并处于模拟安全区',
    (await outerPanel.locator('header').boundingBox()).y >= 48 &&
    buttons.length === 3 && buttons.every(box => box.top === buttons[0].top && box.left >= 0 && box.right <= box.width));
  await page.setViewportSize({ width: 844, height: 390 });
  await outerPanel.evaluate(panel => {
    panel.style.setProperty('--tb-safe-top', '0px');
    panel.style.setProperty('--tb-safe-left', '44px');
    panel.style.setProperty('--tb-safe-right', '44px');
  });
  const landscape = await outerPanel.boundingBox();
  check('横屏浮窗避开模拟的两侧开孔', landscape.x >= 44 && landscape.x + landscape.width <= 844 - 44);
  await outerPanel.evaluate(panel => {
    for (const edge of ['top', 'right', 'bottom', 'left']) panel.style.removeProperty(`--tb-safe-${edge}`);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await languageButton.click();
  // Reproduce an existing rc.1 journal: envelope saved, message source tag not saved.
  const partial = await page.evaluate(async()=>{
    context.chat.push({is_user:false,mes:'<tb><spawn name="原生卫兵" side="ally" scale="hero" weapon="卫兵剑:剑L3"/><spawn name="原生敌军" side="enemy" scale="hero" weapon="卫兵剑:剑L3"/></tb>',swipe_id:0,gen_finished:'complete'});
    await context.saveChat();
    const full=context.saveChat;
    context.saveChat=()=>persistFixture(false);
    try { await __tavernBattleNative.service.scan(); }
    finally { context.saveChat=full; }
    return {phase:__tavernBattleNative.service.status().phase,candidate:__tavernBattleNative.service.store.pendingOperation()?.candidate};
  });
  check('复现旧候选部分落盘而消息标签缺失',partial.phase==='pending'&&disk.get('a').metadata.tavernBattle.lastOperationId===partial.candidate.lastOperationId&&!disk.get('a').chat[0].extra?.tavernBattleSourceId);
  await page.reload();await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='pending');
  await page.locator('#tavern-battle-native-entry').click();await page.getByRole('button',{name:'重试保存',exact:true}).click();await ready();
  check('旧 pending 刷新后以原操作身份完整保存并解锁',await page.evaluate(id=>!__tavernBattleNative.service.store.hasPending()&&__tavernBattleNative.service.store.envelope().lastOperationId===id,partial.candidate.lastOperationId));
  check('来源消息标签经过服务端独立读回确认',typeof disk.get('a').chat[0].extra?.tavernBattleSourceId==='string');
  await frame.locator('[data-action="workspace-tab"][data-tab="units"]').first().click();await idle(frame);
  await frame.locator('[data-action="narrative-approve"]').click();await page.waitForFunction(()=>window.__tavernBattleNative.service.snapshot().storage?.length===2);await idle(frame);
  check('正文候选经面板确认建档并部署',(await state()).rosterIds.length===2);
  // The freshly spawned fixture is not inventory-managed until a real inventory
  // transaction adopts its gear. Create one unequipped item through the UI first.
  await frame.locator('[data-action="workspace-tab"][data-tab="inventory"]').first().click(); await idle(frame);
  await frame.locator('[data-action="inventory-new"]').click();
  await frame.locator('[data-role="inventory-name"]').fill('编辑回归备用剑');
  await frame.locator('[data-action="inventory-preview-draft"]').click();
  await frame.locator('[data-action="inventory-confirm"]').click();
  await page.waitForFunction(() => __tavernBattleNative.service.snapshot().storage?.every(r => r.equipmentManaged));
  await frame.locator('[data-action="workspace-tab"][data-tab="units"]').first().click(); await idle(frame);
  // Managed equipment controls are display-only. This exercises main.captureForm,
  // not just editUnitBuild with a hand-constructed draft (which missed the bug).
  await frame.locator('[data-action="manage-toggle"]').click(); await idle(frame);
  const editBefore = await state(), editedUnit = editBefore.storage.find(r => r.side === 'ally');
  check('编辑回归使用已接管且没有强化的实物装备', editedUnit.equipmentManaged && !editedUnit.snapshot.weapon.recipe.bonuses);
  await frame.locator(`[data-action="storage-edit"][data-id="${editedUnit.id}"]`).click(); await idle(frame);
  await frame.locator('[data-role="edit-name"]').fill('编辑后的原生卫兵');
  const editedHp = Math.max(1, editedUnit.hp - 1), editedMax = editedUnit.base.hpMax + 1;
  await frame.locator('[data-role="edit-hpMax"]').fill(String(editedMax));
  await frame.locator('[data-role="edit-hp"]').fill(String(editedHp));
  await frame.locator('[data-detail-id="edit-notes"] > summary').click();
  await frame.locator('[data-role="edit-note"]').fill('只修改人物资料，不重铸装备');
  await frame.locator('[data-action="storage-preview"]').click(); await idle(frame);
  await frame.locator('[data-role="builder-preview"]').waitFor();
  await frame.locator('[data-action="storage-preview"]').click(); await idle(frame);
  check('人物编辑可重复预览且确认前不改写档案', JSON.stringify((await state()).storage) === JSON.stringify(editBefore.storage));
  await frame.locator('[data-action="builder-confirm"]').click(); await idle(frame);
  const editAfter = await state(), savedEdit = editAfter.storage.find(r => r.id === editedUnit.id);
  check('姓名生命上限当前生命备注均可保存', savedEdit.name === '编辑后的原生卫兵' && savedEdit.hp === editedHp && savedEdit.base.hpMax === editedMax && savedEdit.note === '只修改人物资料，不重铸装备');
  const equipmentSnapshot = r => JSON.stringify(['weapon', 'sidearm', 'armor', 'shield'].map(slot => r.snapshot[slot]));
  check('保存人物资料不改变装备实例随机值或库存归属', equipmentSnapshot(savedEdit) === equipmentSnapshot(editedUnit) && JSON.stringify(editAfter.inventory) === JSON.stringify(editBefore.inventory));
  await frame.locator(`[data-action="storage-edit"][data-id="${editedUnit.id}"]`).click(); await idle(frame);
  await frame.locator('[data-action="storage-preview"]').click(); await idle(frame);
  check('保存后重新打开并直接预览不会误报装备修改', await frame.locator('[data-role="builder-preview"]').isVisible());
  await frame.locator('[data-action="manage-cancel-edit"]').click(); await idle(frame);
  await page.reload(); await ready(); await page.locator('#tavern-battle-native-entry').click();
  await frame.locator('#app h1').waitFor();
  const reloadedEdit = (await state()).storage.find(r => r.id === editedUnit.id);
  check('刷新后人物修改与原装备完整保留', reloadedEdit.name === savedEdit.name && reloadedEdit.hp === editedHp && reloadedEdit.note === savedEdit.note && equipmentSnapshot(reloadedEdit) === equipmentSnapshot(editedUnit));
  await frame.locator('[data-action="workspace-tab"][data-tab="units"]').first().click(); await idle(frame);
  await frame.locator('[data-action="gen-toggle"]').click();await idle(frame);
  await frame.locator('[data-role="gen-name"]').fill('保留的未提交表单');
  const listeners=await page.evaluate(()=>[...handlers.values()].reduce((n,s)=>n+s.size,0));
  await page.evaluate(()=>{for(let i=0;i<100;i++){__tavernBattleNative.close();__tavernBattleNative.open()}});
  check('100次开关保持单个面板和固定监听数',await page.evaluate(n=>document.querySelectorAll('#tavern-battle-native-panel iframe').length===1&&[...handlers.values()].reduce((a,s)=>a+s.size,0)===n,listeners));
  check('关闭重开保留表单草稿',await frame.locator('[data-role="gen-name"]').inputValue()==='保留的未提交表单');
  await languageButton.click();
  check('切语言保留未提交的单位表单',
    await frame.locator('[data-role="gen-name"]').inputValue() === '保留的未提交表单' &&
    await frame.locator('[data-action="gen-add"]').innerText() === 'Preview Unit');
  await languageButton.click();
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();await idle(frame);
  const savesBefore = await page.evaluate(()=>__metadataSaves+__fullSaves);
  await page.evaluate(()=>{__delay=600});
  await frame.locator('[data-role="non-lethal"]').check();
  await frame.locator('body[aria-busy="true"]').waitFor();
  await frame.locator('[data-action="workspace-tab"][data-tab="reports"]').first().click();
  check('慢保存期间仍可立即切换页面',await frame.locator('[data-workspace="reports"]').isVisible());
  await idle(frame);await page.evaluate(()=>{__delay=0});
  check('单次设置变更只保存一次',await page.evaluate(n=>__metadataSaves+__fullSaves===n+1,savesBefore));
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();
  await frame.locator('[data-action="small-start"]').first().click();await page.waitForFunction(()=>!!window.__tavernBattleNative.service.snapshot().battle);await idle(frame);
  check('原生面板可以开始并保存小战',(await state()).battle.kind==='small');
  const battleBeforeLanguage = (await state()).battle;
  const writesBeforeLanguage = await page.evaluate(() => __metadataSaves + __fullSaves);
  await languageButton.click();
  check('战斗中切换英文只更新视图',
    await frame.locator('[data-action="grid-endturn"]').innerText() === 'End Turn' &&
    await frame.locator('.map-key summary').innerText() === 'Legend' &&
    await frame.locator('.command-finish .primary').innerText() === 'Execute Command' &&
    await page.evaluate(count => __metadataSaves + __fullSaves === count, writesBeforeLanguage) &&
    JSON.stringify((await state()).battle) === JSON.stringify(battleBeforeLanguage));
  await languageButton.click();
  check('战场已移除 JEV 切换入口',await frame.locator('[data-role="jev-mode"]').count()===0);
  await frame.locator('[data-action="workspace-tab"][data-tab="settings"]').first().click();
  // isDisabled() follows the wrapping label to its enabled select in Playwright.
  // Inspect this option's native disabled state rather than the enclosing control.
  check('设置保留 JEV 暂不可用禁用提示',await frame.locator('[data-role="llm-mode"] option[value="jev"]').evaluate(option=>option.disabled&&option.textContent.includes('暂不可用')));
  await frame.locator('[data-role="llm-url"]').fill('https://gateway.example/v1');
  await frame.locator('[data-role="llm-token"]').fill('smoke-token');
  await frame.locator('[data-role="llm-model"]').fill('smoke-model');
  check('模型连接未写入聊天存档',!JSON.stringify(await state()).includes('smoke-token'));
  await page.evaluate(()=>{__tavernBattleNative.close();__tavernBattleNative.open()});
  check('关闭重开保留模型连接',await frame.locator('[data-role="llm-model"]').inputValue()==='smoke-model');
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();
  // Tactical maps render the full-auto toggle in the command bar's AI group and the mobile shortcuts; use the first.
  await frame.locator('[data-role="full-auto-battle"]').first().check();await idle(frame);
  await page.waitForTimeout(850);await page.evaluate(()=>__tavernBattleNative.close());await page.waitForTimeout(500);
  const paused=await state();await page.waitForTimeout(800);check('收起面板后全自动暂停',JSON.stringify((await state()).battle)===JSON.stringify(paused.battle));
  await page.evaluate(()=>__tavernBattleNative.open());
  await page.screenshot({path:path.join(artifacts,'desktop.png')});
  const battleId = 'small:' + paused.battle.snap.seed;
  if (!paused.committedOutcomeIds?.includes(battleId)) {
    await frame.locator('[data-action="battle-finish"][data-reason="ceasefire"]').click(); await idle(frame);
  }
  const settled = await state();
  check('小战结算与战报归档只入账一次',settled.reports?.length===1 && settled.reports[0].id===battleId &&
    settled.committedOutcomeIds?.length===1 && settled.committedOutcomeIds[0]===battleId);
  await languageButton.click();
  await frame.locator('.workspace-nav [data-tab="reports"]').click();
  check('英文战报可以查看结算结果并发送完整记录',
    await frame.locator('.report-workspace h2').innerText() === 'Battle Report' &&
    await frame.locator('.report-workspace [data-action="out-digest"]').innerText() === 'Send Full Report');
  await frame.locator('.report-workspace [data-action="out-digest"]').click();await idle(frame);
  check('发送英文逐轮战报包含英文事件和环境',await page.evaluate(() => {
    const message = context.chat.at(-1).mes;
    return message.includes('【Round-by-Round Report') && message.includes('Deployment:') &&
      message.includes('Environment:') && !/布阵：|环境：|高度\d|血量\d/.test(message);
  }));
  await frame.locator('.workspace-nav [data-tab="settings"]').click();
  check('英文指挥设置能识别敌方与第三方选项', await frame.locator('label:has([data-role="llm-faction-enemy"])').innerText() === 'Command Enemies' &&
    await frame.locator('label:has([data-role="llm-faction-neutral"])').innerText() === 'Command Third-Party Forces');
  check('英文设置显示实际用于发送的默认提示', (await frame.locator('[data-role="prompt-template"][data-section="settlement"]').inputValue()).startsWith('Describe the battle using the recorded events.'));
  check('英文附加提示词编辑器和宿主注入使用相同默认模板',
    (await frame.locator('[data-role="prompt-template"][data-section="facts"]').inputValue()).startsWith('【Current Battle Record】') &&
    (await frame.locator('[data-role="prompt-template"][data-section="items"]').inputValue()).startsWith('【Inventory】') &&
    await page.evaluate(() => {
      const content = __prompts['tavern-battle-native:context'];
      return content.includes('【Current Battle Record】') && content.includes('【Unit Records】') && content.includes('## This Reply') &&
        content.includes('Out-of-battle record updates are available.') && !content.includes('## 本次回复');
    }));
  await frame.locator('.workspace-nav [data-tab="reports"]').click();
  await frame.locator('.report-workspace [data-action="out-epilogue"]').click();await idle(frame);
  check('发送英文终章使用英文提示和装备数量说明', await page.evaluate(() => {
    const message = context.chat.at(-1).mes;
    return message.includes('【Battle System · Epilogue】') && message.includes('Use the report to describe the battle in detail. Do not output a <tb> block.') &&
      message.endsWith('Pay attention to changes in equipment quantities. A decrease means the unit members using that equipment were killed.');
  }));
  check('战报只插入用户消息，不自动生成，并保留草稿附件',await page.evaluate(()=>__generations===0&&context.chat.at(-1).is_user===true&&document.getElementById('send_textarea').value.includes('玩家草稿')&&document.getElementById('pending-file').value==='fixture-attachment.txt'&&Object.values(__tavernBattleNative.service.snapshot().reportDeliveries)[0].receipts.epilogue.status==='inserted'));
  await languageButton.click();
  await frame.locator('[data-action="delivery-generate"][data-key="epilogue"]').click();await idle(frame);
  check('用户手动点击发送后只生成一次',await page.evaluate(()=>__generationType==='regenerate'&&__generations===1&&Object.values(__tavernBattleNative.service.snapshot().reportDeliveries)[0].receipts.epilogue.status==='sent'));
  const before=await state();
  const pending=await page.evaluate(async()=>{window.__failure=true;const receipt=await __tavernBattleNative.service.setPromptSettings({sections:{facts:{template:'待确认事实 {{content}}'}}});return {receipt,candidate:__tavernBattleNative.service.store.pendingOperation().candidate};});
  check('保存接口吞错时保持原事实并进入待核实',pending.receipt.status==='pending'&&JSON.stringify(await state())===JSON.stringify(before));
  await page.reload();await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='pending');
  await page.locator('#tavern-battle-native-entry').click();await page.getByRole('button',{name:'重试保存',exact:true}).click();await ready();
  check('刷新后恢复同一候选，不重算业务',await page.evaluate(id=>__tavernBattleNative.service.store.envelope().lastOperationId===id,pending.candidate.lastOperationId));
  const delivered=await page.evaluate(async()=>{const a=document.getElementById('send_textarea').value,b=document.getElementById('pending-file').value;const runtime=__tavernBattleNative;const first=await runtime.messages.send('战报 | /send {{literal}}',{deliveryId:'smoke-delivery',generate:false});await runtime.messages.send('战报 | /send {{literal}}',{deliveryId:'smoke-delivery',generate:false});return {first,count:context.chat.filter(x=>x.extra?.tavernBattleDeliveryId==='smoke-delivery').length,draft:a===document.getElementById('send_textarea').value,attachment:b===document.getElementById('pending-file').value,generations:__generations}});
  check('战报去重且不消费草稿附件',delivered.first.status==='inserted'&&delivered.count===1&&delivered.draft&&delivered.attachment&&delivered.generations===0);
  check('插件插入的战报确实保存到服务端',disk.get('a').chat.filter(x=>x.extra?.tavernBattleDeliveryId==='smoke-delivery').length===1);
  await page.evaluate(()=>switchChat('b'));await ready();check('切聊天得到独立空档',!(await state()).storage?.length&&!(await state()).battle);
  await page.evaluate(async()=>{context.chat.push({is_user:false,mes:'<tb><spawn name="原生连队" side="ally" scale="company" hpMax="40" count="17"/><spawn name="敌方连队" side="enemy" scale="company" hpMax="40" count="17"/></tb>',swipe_id:0,gen_finished:'complete'});await context.saveChat();await __tavernBattleNative.service.scan();});
  await frame.locator('[data-action="workspace-tab"][data-tab="units"]').first().click();await idle(frame);
  await frame.locator('[data-action="narrative-approve"]').click();await page.waitForFunction(()=>__tavernBattleNative.service.snapshot().storage?.length===34);await idle(frame);
  await frame.locator('[data-action="workspace-tab"][data-tab="battle"]').first().click();await idle(frame);
  await frame.locator('[data-role="simple-battle"]').check(); await idle(frame);
  await frame.locator('[data-action="mass-start"]').first().click();await idle(frame);
  const massRound=(await state()).battle.snap.round;
  const massCheckpoint = await page.evaluate(()=>JSON.stringify(context.chatMetadata.tavernBattle));
  const commandSaves = await page.evaluate(()=>{__delay=600;return __metadataSaves+__fullSaves});
  await frame.locator('[data-action="mass-resolve"]').first().click();
  check('会战计算期间立即显示处理中',await frame.locator('body[aria-busy="true"]').count()===1&&await frame.locator('[data-action="mass-resolve"][data-processing="true"]').count()===1);
  await frame.locator('[data-action="mass-resolve"]').first().evaluate(el=>el.click());
  await idle(frame);await page.evaluate(()=>{__delay=0});
  check('战中重复点击不写入存档且开局检查点不变',await page.evaluate(({saves,checkpoint})=>__metadataSaves+__fullSaves===saves&&JSON.stringify(context.chatMetadata.tavernBattle)===checkpoint,{saves:commandSaves,checkpoint:massCheckpoint}));
  check('会战通过面板仅执行一轮',(await state()).battle.kind==='mass'&&(await state()).battle.snap.round===massRound+1);
  await frame.locator('[data-action="battle-finish"][data-reason="ceasefire"]').click();await idle(frame);
  check('会战结算和报告保留',(await state()).reports.length===1&&(await state()).committedOutcomeIds.length===1);
  const exported=await page.evaluate(()=>({format:'tavern-battle-export',version:1,envelope:__tavernBattleNative.service.store.envelope()}));
  await page.getByRole('button',{name:'存档管理',exact:true}).click();
  await page.getByRole('button',{name:'预览切换到脚本模式',exact:true}).click();
  await page.getByRole('button',{name:'确认把最新进度切换到脚本模式',exact:true}).click();
  await page.waitForFunction(()=>__tavernBattleNative.service.status().phase==='handoff');
  check('管理界面回退最新会战进度并停止原生写入',await page.evaluate(()=>context.chatMetadata.variables.panel.reports.length===1&&!__tavernBattleNative.service.canWrite()));
  await page.getByRole('button',{name:'预览迁回原生',exact:true}).click();
  await page.getByRole('button',{name:'确认导入脚本模式进度并迁回原生',exact:true}).click();await ready();
  check('管理界面重新迁回保留进度',(await state()).reports.length===1);
  await page.getByRole('button',{name:'存档管理',exact:true}).click();await page.getByRole('button',{name:'预览清空当前战阵',exact:true}).click();
  await page.getByRole('button',{name:'确认清空当前聊天战阵数据',exact:true}).click();await page.getByRole('button',{name:'确认清空当前聊天战阵数据',exact:true}).waitFor({state:'detached'});await ready();
  check('清空有墓碑，旧变量仍在也不恢复',await page.evaluate(()=>__tavernBattleNative.service.store.envelope().state==='cleared'&&!__tavernBattleNative.service.snapshot().storage?.length&&context.chatMetadata.variables.panel.reports.length===1));
  await page.getByRole('button',{name:'存档管理',exact:true}).click();
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入存档文件',exact:true}).click();
  await (await chooserPromise).setFiles({name:'native-roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.getByRole('button',{name:'确认导入文件并替换当前档案',exact:true}).click();await page.getByRole('button',{name:'确认导入文件并替换当前档案',exact:true}).waitFor({state:'detached'});await ready();
  check('管理界面文件导入恢复完整报告且更换代次',await page.evaluate(old=>__tavernBattleNative.service.snapshot().reports.length===1&&__tavernBattleNative.service.store.envelope().generation!==old,exported.envelope.generation));
  await page.evaluate(()=>switchChat('source-race'));await ready();
  const scanRace = await page.evaluate(async()=>{
    const service=__tavernBattleNative.service, host=service.host, original=host.applyMessageTags.bind(host);
    context.chat.push({is_user:false,mes:'<tb><spawn name="收尾前" side="ally" scale="hero"/></tb>',swipe_id:0,gen_finished:'first-time'});
    await context.saveChat();let changed=false;
    host.applyMessageTags=async(session,tags)=>{if(!changed){changed=true;context.chat[0].mes='<tb><spawn name="最终完整回复" side="ally" scale="hero"/></tb>';}return original(session,tags)};
    try { await service.scan(); } finally { host.applyMessageTags=original; }
    return {ready:service.canWrite(),pending:service.store.hasPending(),proposals:service.snapshot().proposals,storage:service.snapshot().storage};
  });
  check('来源在自动扫描保存前收尾后直接重扫，不锁住档案',scanRace.ready&&!scanRace.pending&&scanRace.proposals.length===1&&scanRace.proposals[0].source.text.includes('最终完整回复'));
  check('重扫仅建立人工候选，不执行失效候选的事实',scanRace.proposals[0].expected.manualOnly===true&&!scanRace.storage?.length);
  const oldSourcePending=await page.evaluate(async()=>{
    const service=__tavernBattleNative.service,host=service.host,original=host.applyMessageTags.bind(host);
    context.chat.push({is_user:false,mes:'<tb><spawn name="旧候选回复" side="ally" scale="hero"/></tb>',swipe_id:0,gen_finished:'first-time'});await context.saveChat();
    // Emulate rc.4 retaining a pre-write source conflict in the recovery journal.
    host.applyMessageTags=async()=>{throw Error('来源消息已编辑、移动或删除，请重新扫描')};
    try { await service.scan(); } finally { host.applyMessageTags=original; }
    const pending=service.store.hasPending();context.chat[1].mes='<tb><spawn name="重试后的最新回复" side="ally" scale="hero"/></tb>';await context.saveChat();return pending;
  });
  check('复现rc.4来源已变化但候选未落盘的恢复记录',oldSourcePending);
  await page.reload();await ready();await page.evaluate(()=>switchChat('source-race'));await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='pending');
  await page.locator('#tavern-battle-native-entry').click();
  await page.getByRole('button',{name:'重试保存',exact:true}).click();await ready();
  await page.waitForFunction(()=>__tavernBattleNative.service.snapshot().proposals?.some(p=>p.source.text.includes('重试后的最新回复')));
  await page.evaluate(()=>__tavernBattleNative.service.scan());
  await page.waitForFunction(()=>{const s=__tavernBattleNative.service;return context.chatId==='source-race'&&s.status().phase==='ready'&&!s.store.hasPending()&&s.snapshot().proposals?.length===2;});
  check('旧来源冲突只需点击重试即可解锁并重扫，重复扫描不重复候选',await page.evaluate(()=>{const s=__tavernBattleNative.service;return !s.store.hasPending()&&s.snapshot().proposals.length===2&&!s.snapshot().storage?.length}));
  // Reported deadlock: the archive reached disk without its message tag, then the reply was regenerated.
  await page.evaluate(()=>switchChat('half-saved'));await ready();
  const halfSaved=await page.evaluate(async()=>{
    const service=__tavernBattleNative.service,full=context.saveChat;
    context.chat.push({is_user:false,mes:'<tb><spawn name="半存档回复" side="ally" scale="hero"/></tb>',swipe_id:0,gen_finished:'complete'});await full();
    context.saveChat=()=>persistFixture(false);
    try { await service.scan(); } finally { context.saveChat=full; }
    const candidate=service.store.pendingOperation()?.candidate.lastOperationId;
    context.chat[0].mes='<tb><spawn name="重新生成的回复" side="ally" scale="hero"/></tb>';context.chat[0].swipe_id=1;await full();
    return candidate;
  });
  check('复现存档已写入、消息标记未保存且回复已重新生成',!!halfSaved&&disk.get('half-saved').metadata.tavernBattle.lastOperationId===halfSaved);
  await page.reload();await ready();await page.evaluate(()=>switchChat('half-saved'));await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='pending');
  await page.locator('#tavern-battle-native-entry').click();
  check('待处理提示用白话说明并提供撤销',await page.evaluate(()=>{const text=document.querySelector('.tb-status').textContent;return text.includes('还没有确认保存成功')&&!/Error|落盘|核实/.test(text);})&&await page.getByRole('button',{name:'撤销这次改动',exact:true}).count()===1);
  await page.getByRole('button',{name:'撤销这次改动',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.tb-status').textContent.includes('已撤销这次改动'));
  check('撤销这次改动写回上一版存档并解锁，不再报部分落盘',await page.evaluate(id=>{const s=__tavernBattleNative.service;return s.status().phase==='ready'&&!s.store.hasPending()&&s.canWrite()&&s.store.envelope().lastOperationId!==id&&!s.snapshot().proposals?.length;},halfSaved)&&disk.get('half-saved').metadata.tavernBattle.lastOperationId!==halfSaved);
  await page.evaluate(()=>__tavernBattleNative.service.scan());
  await page.waitForFunction(()=>__tavernBattleNative.service.snapshot().proposals?.some(p=>p.source.text.includes('重新生成的回复')));
  check('撤销后重扫只得到新回复的人工候选',await page.evaluate(()=>{const s=__tavernBattleNative.service;return !s.store.hasPending()&&s.snapshot().proposals.length===1&&!s.snapshot().storage?.length;}));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'mobile.png')});
  check('390px窗口不横向溢出',await page.evaluate(()=>document.getElementById('tavern-battle-native-panel').getBoundingClientRect().width<=390));
  await page.evaluate(()=>switchChat('loot')); await ready();
  const gear = await page.evaluate(async () => {
    const service = __tavernBattleNative.service;
    context.chat.push({is_user:false,mes:'<tb><spawn name="暂存测试单位" side="ally" scale="hero" weapon="暂存剑:剑L2" armor="暂存锁甲:中甲L2"/></tb>',swipe_id:0,gen_finished:'complete'});
    await context.saveChat();
    await service.scan();
    await service.approve(service.snapshot().proposals[0].id);
    await service.deleteUnit(service.snapshot().storage[0].id);
    return service.snapshot().fallenGear.map(entry => entry.item.name);
  });
  check('删除单位后装备进入暂存', gear.includes('暂存剑') && gear.includes('暂存锁甲'));
  await frame.locator('.workspace-nav [data-tab="inventory"]').click();
  const lootEntry = frame.locator('.inventory-title-heading [data-action="inventory-loot-open"]');
  check('手机宽度下战利品库入口在配装标题旁', await lootEntry.evaluate(el => {
    const button = el.getBoundingClientRect(), title = el.previousElementSibling.getBoundingClientRect();
    return button.left >= title.right && button.right <= el.ownerDocument.documentElement.clientWidth;
  }));
  await lootEntry.click();
  await frame.getByText('用于临时保存阵亡和删除单位物品', { exact:true }).waitFor();
  await frame.locator('[data-role="inventory-loot-floors"]').fill('9');
  await frame.locator('[data-action="inventory-loot-retention"]').click(); await idle(frame);
  await frame.getByText('已保存暂存层数', { exact:true }).waitFor();
  const lootRow = name => frame.locator('.inventory-loot-row').filter({hasText:name});
  check('暂存层数更新到当前暂存装备', (await lootRow('暂存剑').textContent()).includes('剩余 9 层'));
  await languageButton.click();
  await frame.getByRole('heading', {name:'Loot Vault', exact:true}).waitFor();
  await lootRow('暂存剑').getByRole('checkbox').check();
  await frame.getByRole('button', {name:'Send Selected', exact:true}).click(); await idle(frame);
  await frame.getByText('Selected gear added to chat.', {exact:true}).waitFor();
  check('发送只插入所选装备且不自动生成', await page.evaluate(() => {
    const message = context.chat.at(-1);
    return message.is_user && message.mes.includes('【Loot Vault】') && message.mes.includes('暂存剑') && !message.mes.includes('暂存锁甲') && __generations === 0;
  }));
  await lootRow('暂存锁甲').getByRole('checkbox').check();
  await frame.getByRole('button', {name:'Delete Selected', exact:true}).click(); await idle(frame);
  await frame.getByText('Selected gear deleted.', {exact:true}).waitFor();
  const lootSave = await state();
  check('删除仅移除所选，层数和剩余战利品保存到当前聊天',
    lootSave.fallenGearFloors === 9 && lootSave.fallenGear.some(entry => entry.item.name === '暂存剑') &&
    !lootSave.fallenGear.some(entry => entry.item.name === '暂存锁甲') && !lootSave.inventory.some(item => gear.includes(item.name) && item.qty > 0));
  await languageButton.click();
  await page.evaluate(()=>__tavernBattleNative.close());
  const mobileEntry = page.locator('#tavern-battle-native-entry');
  const mobileBox = await mobileEntry.boundingBox();
  check('缩小窗口后悬浮球仍在屏幕内',mobileBox.x>=0&&mobileBox.y>=0&&mobileBox.x+mobileBox.width<=390&&mobileBox.y+mobileBox.height<=844);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobileBox.x+26,y:mobileBox.y+26}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:300}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const dragged = await mobileEntry.boundingBox();
  check('手机触摸拖动可用且不会误开',Math.abs(dragged.x-54)<3&&await page.evaluate(()=>document.getElementById('tavern-battle-native-panel').hidden));
  await mobileEntry.click();
  check('拖动后仍能点击打开',await page.locator('#tavern-battle-native-panel').isVisible());
  await page.evaluate(()=>__tavernBattleNative.dispose());
  check('停用清除入口面板、注入和监听',await page.evaluate(()=>!document.getElementById('tavern-battle-native-entry')&&!document.querySelector('iframe')&&[...handlers.values()].every(s=>s.size===0)&&!__prompts['tavern-battle-native:context']));
  await page.evaluate(() => localStorage.removeItem('fixture-tb-language'));
  await page.goto(url + '?lang=en-US'); await ready(); await entry.click();
  check('英文宿主首次打开时，浮窗、战斗页和世界书默认使用英文',
    await page.getByRole('button', { name: 'Saves', exact: true }).count() === 1 &&
    await languageButton.innerText() === '简体中文' &&
    await page.evaluate(() => Object.values(__prompts).some(text => text.includes('from spacecraft to spacewalkers')) &&
      !localStorage.getItem('fixture-tb-language')));
  await languageButton.click(); await page.reload(); await ready(); await entry.click();
  check('英文宿主刷新后保留玩家手动选择的中文',
    await page.getByRole('button', { name: '存档管理', exact: true }).count() === 1 &&
    await languageButton.innerText() === 'English' && await page.evaluate(() => document.documentElement.lang === 'en-US'));
  check('无未处理页面异常',errors.length===0);
} catch(error) {
  console.error(error);process.exitCode=1;
  try {
    const diagnosis=await page.evaluate(async()=>{const s=window.__tavernBattleNative?.service;if(!s)return {error:'Native runtime unavailable'};return {status:s.status().receipt,pending:s.store.pendingOperation(),disk:await s.host.readPersisted(s.host.session().scope)}});
    writeFileSync(path.join(artifacts,'settlement-save.json'),JSON.stringify(diagnosis,null,2));
    console.error('PAGE ERRORS',errors);
    console.error('STATUS',await page.evaluate(()=>({chatId:context.chatId,session:window.__tavernBattleNative?.service.store.session(),snapshot:window.__tavernBattleNative?.service.snapshot(),phase:window.__tavernBattleNative?.service.status().phase,error:window.__tavernBattleNative?.service.status().error,receipt:window.__tavernBattleNative?.service.status().receipt,text:document.querySelector('.tb-status')?.textContent})));
    await page.screenshot({path:path.join(artifacts,'failure.png')});
  } catch(diagnosticError) { console.error('Diagnostic capture failed',diagnosticError); }
} finally {
  writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({time:new Date().toISOString(),status:process.exitCode?'failed':'passed',metadataMode,results,errors,realHost:false},null,2)+'\n');
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
