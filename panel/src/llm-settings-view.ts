import { escapeHtml as esc } from './battle-presentation.js';
import type { LlmSettings } from './llm-settings.js';
export function renderLlmSettings(c: LlmSettings, status = ''): string {
  const models = [...new Set([...(c.model ? [c.model] : []), ...c.models])];
  return `<section><h2>上下文与开战配置</h2>
    <label>配置方式 <select data-role="llm-mode"><option value="manual" ${c.enabled ? '' : 'selected'}>手动配置 · 内置自动战斗</option><option value="llm" ${c.enabled ? 'selected' : ''}>普通 LLM 读取上下文</option><option value="jev" disabled>jev指挥功能(未完成，勿选)</option></select></label>
    <p>启用后，开战前读取最近所选层数的已完成用户与 AI 正文，选择双方指挥官风格、能力、战斗形式、任务和战场。优先遵循明确设定，信息不足时结合上下文自行判断；没有可读取正文时沿用准备设置。指挥配置影响内置自动行动的取舍，手动命令仍由你决定。</p>
    <label><input data-role="llm-battle-scale" type="checkbox" ${c.selectBattleScale ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>由 LLM 选择战场规模</label>
    <p class="sub">开启：由 LLM 选择小规模战斗或军团会战。关闭：沿用按参战队伍确定的规模，LLM 继续选择指挥官与该规模支持的战场配置。仅在普通 LLM 模式下生效。</p>
    <div class="row"><label>读取最近层数 <input data-role="llm-window" type="number" min="1" max="100" value="${c.windowSize}"></label><label>API URL <input data-role="llm-url" type="url" value="${esc(c.url)}" placeholder="https://your-api.example/v1"></label><label>API Key <input data-role="llm-token" type="password" autocomplete="off" value="${esc(c.token)}"></label></div>
    <div class="row"><button data-action="llm-models">拉取模型</button><label>选择模型 <select data-role="llm-model-list"><option value="">请选择模型</option>${models.map(id => `<option value="${esc(id)}" ${c.model === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label><label>模型 ID（也可手填）<input data-role="llm-model" value="${esc(c.model)}"></label></div>
    <p class="sub">填写后即时保存。API URL、Key、模型列表与选择在本机酒馆中共用，不随聊天或角色卡的切换、删除而改变。使用 OpenAI 兼容接口；启用后会把所选正文发送给该服务。一层是一条已完成的用户或 AI 消息，每条最多读取末尾 6000 字符。</p><p role="status">${esc(status)}</p>
  </section>`;
}
