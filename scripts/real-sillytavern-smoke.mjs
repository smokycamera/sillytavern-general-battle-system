import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';

// Run only against the disposable, credential-free host under artifacts/host-validation.
const hostUrl=process.env.TB_TEST_HOST ?? 'http://127.0.0.1:8101';
const artifacts=path.resolve('artifacts/real-sillytavern');mkdirSync(artifacts,{recursive:true});
const results=[],errors=[],requests=[];
const api=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString('utf8');
  requests.push({url:req.url,body:body?JSON.parse(body):undefined});
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/models')){res.end(JSON.stringify({object:'list',data:[{id:'native-fixture',object:'model',owned_by:'test'}]}));return;}
  res.end(JSON.stringify({id:'test-completion',object:'chat.completion',model:'native-fixture',created:Math.floor(Date.now()/1000),choices:[{index:0,message:{role:'assistant',content:'这是本地验收模型生成的完整战后叙述。'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const apiUrl=`http://127.0.0.1:${api.address().port}/v1`;
const browser=await chromium.launch({executablePath:process.env.TB_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>errors.push(String(error)));
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS '+name)};
try{
  await page.goto(hostUrl);await page.waitForFunction(()=>!!window.SillyTavern?.getContext()?.characters);
  // Complete the first-run dialog before exercising the host's composer.
  const welcome=page.locator('dialog[open]');
  if(await welcome.count()){
    await welcome.locator('.popup-input').fill('Native Tester');
    await welcome.locator('.popup-button-ok').click();await welcome.waitFor({state:'hidden'});
  }
  await page.evaluate(async()=>{
    let context=SillyTavern.getContext();const name='战阵原生验收';
    if(!context.characters.some(c=>c.name===name)){
      const response=await fetch('/api/characters/create',{method:'POST',headers:context.getRequestHeaders(),body:JSON.stringify({ch_name:name,description:'仅用于原生扩展的隔离自动验收。',first_mes:'验收开始。'})});
      if(!response.ok)throw Error('创建测试角色失败 '+response.status);
      await context.getCharacters();context=SillyTavern.getContext();
    }
    const index=context.characters.findIndex(c=>c.name===name);if(index<0)throw Error('测试角色未加载');
    await context.selectCharacterById(index);
  });
  await page.waitForFunction(()=>window.__tavernBattleNative?.service.status().phase==='ready');
  check('真实 SillyTavern 在无助手环境初始化',await page.evaluate(()=>!window.TavernHelper&&SillyTavern.getContext().characters[SillyTavern.getContext().characterId].name==='战阵原生验收'));
  const saved=await page.evaluate(async()=>{const s=__tavernBattleNative.service;const r=await s.transact(before=>({...before,nativeRealHostProbe:{id:crypto.randomUUID()}}));const disk=await s.host.readPersisted(r.session.scope);return r.status==='confirmed'&&disk.tavernBattle.lastOperationId===r.operationId;});
  check('真实聊天保存与独立读回一致',saved);
  await page.evaluate(()=>__tavernBattleNative.open());
  const frame=page.frameLocator('#tavern-battle-native-panel iframe');await frame.locator('#app h1').waitFor();
  check('真实宿主加载独立面板',await frame.locator('[data-action="workspace-tab"]').count()>0);
  await page.evaluate(()=>__tavernBattleNative.close());
  await page.evaluate(async url=>{
    const main=await import('/script.js');main.changeMainAPI('openai');
    const c=SillyTavern.getContext();Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:url,custom_model:'native-fixture',stream_openai:false,custom_include_body:'',custom_exclude_body:'',custom_include_headers:''});
    document.querySelector('#chat_completion_source').value='custom';
    document.querySelector('#chat_completion_source').dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#api_button_openai').click();
  },apiUrl);
  await page.waitForFunction(()=>SillyTavern.getContext().onlineStatus!=='no_connection');
  await page.locator('#send_textarea').fill('/echo draft-must-stay {{user}} | 尚未发送的草稿');
  check('真实输入框已有待发草稿',await page.locator('#send_textarea').inputValue()==='/echo draft-must-stay {{user}} | 尚未发送的草稿');
  await page.locator('#file_form_input').setInputFiles({name:'pending-player-note.txt',mimeType:'text/plain',buffer:Buffer.from('This attachment must remain pending.')});
  const sent=await page.evaluate(async()=>{
    const draft=document.querySelector('#send_textarea').value;
    const file=document.querySelector('#file_form_input').files[0]?.name;
    const id='real-host:'+crypto.randomUUID();const receipt=await __tavernBattleNative.messages.send('原生战报：验收一次结构化投递。',{deliveryId:id});
    const c=SillyTavern.getContext();const disk=await __tavernBattleNative.service.host.readChat(__tavernBattleNative.service.host.session().scope);
    return {receipt,draftUntouched:draft===document.querySelector('#send_textarea').value,fileUntouched:!!file&&file===document.querySelector('#file_form_input').files[0]?.name,userCount:c.chat.filter(m=>m.extra?.tavernBattleDeliveryId===id).length,reply:c.chat.at(-1)?.mes,durableReply:disk.at(-1)?.mes===c.chat.at(-1)?.mes};
  });
  writeFileSync(path.join(artifacts,'generation.json'),JSON.stringify(sent,null,2));
  check('真实生成完成且没有重复插入战报',sent.receipt.status==='sent'&&sent.userCount===1&&sent.reply.includes('本地验收模型'));
  check('真实宿主生成保留输入框草稿和待发附件',sent.draftUntouched&&sent.fileUntouched);
  check('真实生成结果持久保存',sent.durableReply);
  check('请求确实经过本地模型接口',requests.some(r=>r.url.endsWith('/chat/completions')));
  await page.evaluate(()=>__tavernBattleNative.open());await page.screenshot({path:path.join(artifacts,'desktop.png')});
}catch(error){console.error(error);console.error('HOST',await page.evaluate(()=>({status:window.__tavernBattleNative?.service.status().phase,detail:document.querySelector('.tb-status')?.textContent,online:window.SillyTavern?.getContext()?.onlineStatus})));await page.screenshot({path:path.join(artifacts,'failure.png')});process.exitCode=1;}
finally{writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({time:new Date().toISOString(),status:process.exitCode?'failed':'passed',host:'SillyTavern 1.19.0',commit:'06bde939fb1e9c4c8d8641d810f0a916b5bce127',realHost:true,results,errors,modelRequests:requests.map(r=>r.url)},null,2));await browser.close();await new Promise(resolve=>api.close(resolve));}
