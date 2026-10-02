import { escapeHtml as esc } from './battle-presentation.js';
import type { LlmSettings } from './llm-settings.js';
export function renderLlmSettings(c: LlmSettings, status = ''): string {
  const models = [...new Set([...(c.model ? [c.model] : []), ...c.models])];
  return `<section><h2>上下文与开战配置</h2>
    <label>配置方式 <select data-role="llm-mode"><option value="manual" ${c.enabled ? '' : 'selected'}>手动配置 · 内置自动战斗</option><option value="llm" ${c.enabled ? 'selected' : ''}>普通 LLM 读取上下文</option><option value="jev" disabled>jev指挥功能(未完成，勿选)</option></select></label>
    <p>开战前读取最近的正文，由模型选择双方指挥、任务与战场。指挥配置只影响自动行动。</p>
    <label><input data-role="llm-battle-scale" type="checkbox" ${c.selectBattleScale ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>由 LLM 选择战场规模</label>
    <p class="sub">关闭时按卡数决定：32张及以下为小战，更多为会战。</p>
    <label><input data-role="llm-map-design" type="checkbox" ${c.designMap === true ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>由 LLM 设计地图</label>
    <p class="sub">按正文布置城市、河流、地点与双方位置，每次开战多请求1次。关闭时使用随机地图。</p>
    <label><input data-role="llm-vip" type="checkbox" ${c.selectVip === true ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>由 LLM 选择护送／拦截 VIP</label>
    <p class="sub">无法确定时使用默认对象。</p>
    <div class="row"><label>读取最近层数 <input data-role="llm-window" type="number" min="1" max="100" value="${c.windowSize}"></label><label>API URL <input data-role="llm-url" type="url" value="${esc(c.url)}" placeholder="https://your-api.example/v1"></label><label>API Key <input data-role="llm-token" type="password" autocomplete="off" value="${esc(c.token)}"></label></div>
    <div class="row"><button data-action="llm-models">拉取模型</button><label>选择模型 <select data-role="llm-model-list"><option value="">请选择模型</option>${models.map(id => `<option value="${esc(id)}" ${c.model === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label><label>模型 ID（也可手填）<input data-role="llm-model" value="${esc(c.model)}"></label></div>
    <p class="sub">OpenAI 兼容接口，填写后自动保存，所有聊天共用。启用后会把所选正文发送给该服务，每层最多读取末尾6000字。</p><p role="status">${esc(status)}</p>
    <details><summary>配置恢复</summary><button data-action="llm-settings-backup">备份原配置（含Key）</button><button data-action="llm-settings-reset">重置选项并保留连接</button><button data-action="llm-settings-clear">清空副API配置和Key</button></details>
  </section>`;
}
