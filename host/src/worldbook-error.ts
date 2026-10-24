const messages = {
  'activation-unsupported': '当前酒馆未提供世界书激活接口，请使用手动选择模式',
  'chat-required': '请先打开当前角色卡的聊天，再使用绑定世界书模式',
  'activation-missing': '尚未取得当前聊天的世界书激活结果，请先让角色卡生成一次正文',
  'scope-changed': '当前聊天已变化，请在当前角色卡中重新开战',
  'headers-unavailable': '当前酒馆未提供世界书读取接口',
  'http': '世界书读取失败',
  'invalid-json': '世界书接口未返回有效JSON，请检查酒馆连接',
  'catalog-invalid': '酒馆未返回世界书列表',
  'entries-invalid': '世界书条目格式无法识别',
  'activation-read-failed': '读取当前角色卡世界书激活结果失败，请检查酒馆连接或改用手动选择模式',
  'selected-read-failed': '读取已选择的副API世界书失败，请检查酒馆连接或重新选择世界书',
  'selected-unavailable': '当前酒馆无法读取已选择的副 API 世界书',
  'selection-missing': '已选择的世界书条目已变更，请重新选择',
} as const;
type WorldbookErrorCode = keyof typeof messages;
/** Controlled codes preserve diagnostics across the host/panel iframe without echoing remote errors or credentials. */
export class WorldbookReadError extends Error {
  override name = 'WorldbookReadError';
  constructor(readonly code: WorldbookErrorCode, readonly status?: number) {
    super(messages[code] + (code === 'http' && Number.isInteger(status) && status! >= 400 && status! <= 599 ? `（HTTP ${status}）` : ''));
  }
}
export function worldbookReadError(error: unknown): WorldbookReadError | undefined {
  if (error instanceof WorldbookReadError) return error;
  if (!error || typeof error !== 'object') return;
  const value = error as { name?: unknown; code?: unknown; status?: unknown };
  if (value.name === 'WorldbookReadError' && typeof value.code === 'string' && Object.hasOwn(messages, value.code))
    return new WorldbookReadError(value.code as WorldbookErrorCode, typeof value.status === 'number' ? value.status : undefined);
}
