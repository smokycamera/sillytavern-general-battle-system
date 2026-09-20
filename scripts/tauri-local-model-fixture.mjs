import http from 'node:http';
import fs from 'node:fs';
const directory='artifacts/host-validation/tauritavern/data/default-user/extensions/tavern-battle-native-candidate-probe';
const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString('utf8');
  console.log(req.method+' '+req.url);
  res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');
  if(req.url.endsWith('/models')){res.end(JSON.stringify({object:'list',data:[{id:'native-fixture',object:'model',owned_by:'test'}]}));return;}
  if(!req.url.endsWith('/chat/completions')){res.statusCode=404;res.end('{}');return;}
  const input=JSON.parse(body);if(input.stream){res.statusCode=400;res.end(JSON.stringify({error:{message:'Fixture expects non-streaming'}}));return;}
  res.end(JSON.stringify({id:'tauri-fixture',object:'chat.completion',model:'native-fixture',choices:[{index:0,message:{role:'assistant',content:'这是本地验收模型生成的完整战后叙述。'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
});
server.listen(0,'127.0.0.1',()=>{const modelUrl=`http://127.0.0.1:${server.address().port}/v1`;fs.writeFileSync(directory+'/fixture-config.json',JSON.stringify({modelUrl}));console.log('Local test model listening');});
