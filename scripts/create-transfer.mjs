/** 本地换机资料包：工程、全部恢复点和可选的单次会话快照；不读取认证/账号数据库。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] ?? path.join(path.dirname(root), 'tavern-battle-transfer-' + new Date().toISOString().slice(0, 10)));
if (path.dirname(destination).toLowerCase() !== path.dirname(root).toLowerCase() || !path.basename(destination).startsWith('tavern-battle-transfer-')) throw new Error('迁移目录必须是工程同级的独立tavern-battle-transfer目录');
if (fs.existsSync(destination)) throw new Error('目标已存在，请使用新的目录名，不覆盖已有备份');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifest = { createdAt: new Date().toISOString(), source: root, kind: 'development-transfer-not-release', exclusions: ['project/node_modules', 'project/.git', 'account credentials and databases'], files: [] };
function put(relative, bytes, source) {
  const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  const sha256 = hash(bytes); if (hash(fs.readFileSync(target)) !== sha256) throw new Error('复制校验失败：' + relative);
  manifest.files.push({ path: relative.split(path.sep).join('/'), bytes: bytes.length, sha256, ...(source ? { source } : {}) });
}
function copyDirectory(source, relative, excluded = new Set()) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name)) continue;
    const origin = path.join(source, entry.name), target = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('发现链接，先人工核对目标：' + origin);
    if (entry.isDirectory()) copyDirectory(origin, target, excluded);
    else if (entry.isFile()) put(target, fs.readFileSync(origin), origin);
  }
}
copyDirectory(root, 'tavern-battle', new Set(['node_modules', '.git']));
copyDirectory(path.join(path.dirname(root), 'tavern-battle-checkpoints'), 'tavern-battle-checkpoints');
put('START-MIGRATION.md', fs.readFileSync(path.join(root, 'docs/move-to-new-computer.md')));

if (process.argv[3]) {
  const session = path.resolve(process.argv[3]);
  if (!path.basename(session).startsWith('rollout-') || !session.endsWith('.jsonl')) throw new Error('第三参数仅接受明确的rollout会话日志');
  const bytes = fs.readFileSync(session), end = bytes.lastIndexOf(10);
  if (end < 0) throw new Error('会话日志没有完整行');
  const complete = bytes.subarray(0, end + 1);
  const records = complete.toString('utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
  put(path.join('conversation', path.basename(session)), complete, session);
  const messages = [];
  for (const event of records) {
    const p = event.payload;
    if (event.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role) || p.channel === 'analysis') continue;
    const text = (p.content ?? []).map((c) => c.text ?? '').join('\n');
    if (!text.trim() || /^<(?:codex_internal_context|environment_context|permissions|app-context)/.test(text.trim())) continue;
    messages.push(`### ${p.role === 'user' ? '用户' : '助手'} ${event.timestamp ?? ''}\n\n${text}`);
  }
  put('conversation/对话文字备份.md', Buffer.from('# 本任务对话文字快照\n\n仅提取已记录的用户与助手文字，不含工具结果；完整材料见同目录JSONL。打包之后的消息不在此快照中。当前实施状态以工程执行记录为准。\n\n' + messages.join('\n\n---\n\n')));
  manifest.conversation = { source: session, completeRecords: records.length, textMessages: messages.length, omittedTrailingBytes: bytes.length - complete.length, snapshotOnly: true };
}
fs.writeFileSync(path.join(destination, 'TRANSFER-MANIFEST.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ destination, files: manifest.files.length, bytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0), conversation: manifest.conversation }));
