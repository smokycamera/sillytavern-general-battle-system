import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// Real built extension in Chromium; the host and MVU event/writeback contracts are simulated.
const root = path.resolve('release/native-candidate'), disk = new Map();
const html = tauri => `<!doctype html><html><body><div id="chat"></div><script type="module">
import { setSaving } from '/script.js';
const handlers=new Map();window.explicitSaves=0;window.naturalSaves=0;
const ctx=window.context={characterId:0,characters:[{avatar:'fixture.png',name:'Fixture'}],chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},
getRequestHeaders:()=>({'Content-Type':'application/json'}),setExtensionPrompt(){},saveSettingsDebounced(){},
eventTypes:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHAT_CHANGED'].map(x=>[x,x])),
eventSource:{on(k,cb){const list=handlers.get(k)||new Set();list.add(cb);handlers.set(k,list)},removeListener(k,cb){handlers.get(k)?.delete(cb)},async emit(k,...args){for(const cb of handlers.get(k)||[])await cb(...args)}},
async saveMetadata(){await fetch('/metadata',{method:'POST',body:JSON.stringify({id:ctx.chatId,metadata:ctx.chatMetadata})})},
async saveChat(){window.explicitSaves++;await save(true)}};
async function save(full){setSaving(true);try{const data={id:ctx.chatId,metadata:structuredClone(ctx.chatMetadata),chat:structuredClone(ctx.chat)};await new Promise(r=>setTimeout(r,70));await fetch('/save',{method:'POST',body:JSON.stringify(data)})}finally{setSaving(false)}}
window.SillyTavern={getContext:()=>ctx};
${tauri ? `window.__TAURI_RUNNING__=true;window.__TAURITAVERN__={api:{chat:{open(ref){return {metadata:{get:async()=>{const r=await fetch('/api/chats/get',{method:'POST',body:JSON.stringify({file_name:ref.fileName})});return (await r.json())[0].chat_metadata}},history:{tail:async({limit})=>{const r=await fetch('/api/chats/get',{method:'POST',body:JSON.stringify({file_name:ref.fileName})});return {messages:(await r.json()).slice(1).slice(-limit)}}}}}}}};` : ''}
await import('/extension/index.js');
window.installMvu=mode=>{ctx.eventSource.on('MESSAGE_RECEIVED',async id=>{
const apply=async()=>{await new Promise(r=>setTimeout(r,40));ctx.chat[id].mes+='\\n<UpdateVariable>MVU</UpdateVariable>\\n<StatusPlaceHolderImpl/>';ctx.chat[id].variables=[{stat_data:{好感:42},schema:{}}];ctx.chatMetadata={...ctx.chatMetadata,variables:{stat_data:{好感:42}}}};
if(mode==='normal')await apply();else {const rendered=async current=>{if(current!==id)return;handlers.get('CHARACTER_MESSAGE_RENDERED').delete(rendered);await apply()};ctx.eventSource.on('CHARACTER_MESSAGE_RENDERED',rendered)}
})};
window.reply=async(autoSave=true)=>{await ctx.eventSource.emit('GENERATION_STARTED','normal',{},false);const id=ctx.chat.length;ctx.chat.push({is_user:false,mes:'<tb><spawn name="卫兵'+id+'" side="ally" scale="hero"/></tb>',swipe_id:0,send_date:'now-'+id,gen_finished:'done'});await ctx.eventSource.emit('GENERATION_ENDED',ctx.chat.length);await ctx.eventSource.emit('MESSAGE_RECEIVED',id);await ctx.eventSource.emit('CHARACTER_MESSAGE_RENDERED',id);if(autoSave){window.naturalSaves++;await save(true)}};
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(url.searchParams.has('tauri'))); return; }
    if (url.pathname === '/script.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('let flag=false;export {flag as isChatSaving};export const setSaving=value=>{flag=value};'); return; }
    if (url.pathname === '/scripts/user.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export const accountsEnabled=false;export const getCurrentUserHandle=()=>"smoke-user";'); return; }
    if (url.pathname === '/api/users/me') { res.setHeader('Content-Type', 'application/json'); res.end('{"handle":"smoke-user"}'); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/save') disk.set(data.id, data);
      else if (url.pathname === '/metadata') disk.set(data.id, { ...disk.get(data.id), ...data });
      else if (url.pathname === '/api/chats/get') { const save = disk.get(data.file_name); res.end(JSON.stringify([{ chat_metadata: save?.metadata ?? {} }, ...(save?.chat ?? [])])); return; }
      res.end('{}'); return;
    }
    const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/extension\//, ''));
    if (!file.startsWith(root + path.sep)) throw Error('Outside package');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(file));
  } catch (error) { res.statusCode = 404; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.TB_BROWSER, headless: true });
const results = [];
try {
  for (const tauri of [false, true]) for (const mode of ['normal', 'rendered']) {
    disk.clear(); const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/${tauri ? '?tauri' : ''}`);
    await page.waitForFunction(() => window.__tavernBattleNative?.service.status().phase === 'ready');
    await page.evaluate(async mode => { await __tavernBattleNative.service.setStorySync(true); installMvu(mode); await reply(); }, mode);
    await page.waitForFunction(() => __tavernBattleNative.service.snapshot().storage?.length === 1 && !__tavernBattleNative.service.store.hasPending());
    assert.equal(await page.evaluate(() => explicitSaves), 0, 'The reply must use only the host save');
    assert.deepEqual(disk.get('a').chat[0].variables[0].stat_data, { 好感: 42 });
    assert.deepEqual(disk.get('a').metadata.variables.stat_data, { 好感: 42 });
    assert.match(disk.get('a').chat[0].extra.tavernBattleSourceId, /^tb-source:/);
    await page.evaluate(() => reply(false));
    await page.waitForFunction(() => __tavernBattleNative.service.snapshot().storage?.length === 2 && !__tavernBattleNative.service.store.hasPending());
    assert.equal(await page.evaluate(() => explicitSaves), 1, 'A missing host save must get one fallback');
    assert.deepEqual(errors, []);
    results.push({ host: tauri ? 'TauriTavern contract' : 'SillyTavern contract', mvu: mode, naturalSaves: 1, explicitFallback: 1 });
    await page.close();
  }
  console.log(JSON.stringify({ browser: 'Chromium', simulatedMvu: true, results }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
