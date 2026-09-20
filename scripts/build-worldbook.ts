import { readFileSync, writeFileSync } from 'node:fs';
import { CORE_PROTOCOL, PROMPT_CARDS } from '../panel/src/narrative-prompt.js';
const path='assets/worldbook/!通用战斗系统约束.json';
const book=JSON.parse(readFileSync(path,'utf8'));
const entries=Object.values(book.entries) as {comment:string;constant:boolean;content:string}[];
if(entries.length!==4 || entries.some(e=>!e.content.trim()))throw Error('世界书条目不完整');
const output=JSON.stringify(book,null,2)+'\n';
const preview='# 战阵世界书\n\n以导入JSON为唯一规范源；保留用户条目设置。本版4条常驻。示例仅说明格式。\n\n'+entries.map(e=>'## '+e.comment+'（'+(e.constant?'常驻':'按需')+'）\n\n\x60\x60\x60xml\n'+e.content+'\n\x60\x60\x60').join('\n\n')+'\n';
if(process.argv.includes('--check')){
 if(readFileSync('docs/worldbook-xml-markdown.md','utf8').replace(/\r\n/g,'\n')!==preview)throw Error('世界书阅读版未更新');
}else{writeFileSync(path,output);writeFileSync('docs/worldbook-xml-markdown.md',preview);}
console.log('世界书：保留导入的4条设置；核心与'+PROMPT_CARDS.length+'条规格已同步，核心字符'+CORE_PROTOCOL.length);
