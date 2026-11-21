import { ui } from './ui-language.js';
import { escapeHtml as esc } from './battle-presentation.js';
import { COMMAND_THINKING_OFF_PARAMS, type LlmSettings } from './llm-settings.js';
export function renderLlmSettings(c: LlmSettings, status = '', worldbooks = ''): string {
  const models = [...new Set([...(c.model ? [c.model] : []), ...c.models])];
  return `<section class="llm-settings"><h2>${ui("上下文与开战配置")}</h2>
    <label class="llm-setting-field">${ui("配置方式")} <select data-role="llm-mode"><option value="manual" ${c.enabled ? '' : 'selected'}>${ui("手动配置 · 内置自动战斗")}</option><option value="llm" ${c.enabled ? 'selected' : ''}>${ui("普通 LLM 读取上下文")}</option><option value="jev" disabled>${ui("JEV 指挥（暂不可用）")}</option></select></label>
    <p>${ui("开战前读取最近的正文，由模型选择双方指挥、任务与战场。指挥配置只影响自动行动。")}</p>
    <div class="llm-command-factions"><label><input data-role="llm-enemy-command" type="checkbox" ${c.commandEnemy ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>${ui("LLM 指挥")}</label>
    ${(['enemy','neutral'] as const).map(side => `<label><input data-role="llm-faction-${side}" type="checkbox" ${c.commandFactions?.[side] !== false ? 'checked' : ''} ${c.enabled && c.commandEnemy ? '' : 'disabled'}>${side === 'enemy' ? '指挥敌人' : '指挥第三方'}</label>`).join('')}</div>
    <label class="llm-setting-field">${ui("指挥间隔")} <select data-role="llm-command-interval" ${c.enabled ? '' : 'disabled'}><option value="round" ${c.commandInterval !== 'situation' ? 'selected' : ''}>${ui("每回合（推荐，调用次数少）")}</option><option value="situation" ${c.commandInterval === 'situation' ? 'selected' : ''}>${ui("根据战况（次数多）")}</option></select></label>
    <label class="llm-setting-field">${ui("指挥思考模式")} <select data-role="llm-command-thinking" ${c.enabled ? '' : 'disabled'}><option value="auto" ${!c.commandThinking || c.commandThinking === 'auto' ? 'selected' : ''}>${ui("默认（时间可能不稳定）")}</option><option value="off" ${c.commandThinking === 'off' ? 'selected' : ''}>${ui("非思考（默认参数ds官渠，可在兼容设置调整，不同渠道参数可能不同）")}</option></select></label>
    ${c.commandThinking === 'off' ? `<details><summary>${ui("高级兼容设置")}</summary>
      <label>${ui("附加参数")}<textarea data-role="llm-command-params" rows="4" spellcheck="false" ${c.enabled ? '' : 'disabled'}>${esc(c.commandThinkingOffDraft ?? c.commandThinkingOffParams ?? COMMAND_THINKING_OFF_PARAMS)}</textarea></label>
      <button data-action="llm-command-params-reset" ${c.enabled ? '' : 'disabled'}>${ui("恢复默认")}</button>
      <p class="sub">支持 JSON 对象，或每行一个 参数名=值（如 参数名="值"）。默认使用 DeepSeek 官渠关闭思考的参数；填 {} 不附加参数。</p><p data-role="llm-command-params-status" role="status">${c.commandThinkingOffDraft !== undefined ? '未完成的草稿已保留；请求仍使用上一份有效参数' : ''}</p></details>` : ''}
    <label><input data-role="llm-map-design" type="checkbox" ${c.designMap === true ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>${ui("由 LLM 设计地图")}</label>
    <p class="sub">${ui("按正文布置城市、河流、地点与双方位置，每次开战多请求1次。关闭时使用随机地图。")}</p>
    <label><input data-role="llm-vip" type="checkbox" ${c.selectVip === true ? 'checked' : ''} ${c.enabled ? '' : 'disabled'}>${ui("由 LLM 选择护送／拦截 VIP")}</label>
    <p class="sub">${ui("无法确定时使用默认对象。")}</p>
    ${worldbooks}
    <div class="row"><label>${ui("读取最近层数")} <input data-role="llm-window" type="number" min="1" max="100" value="${c.windowSize}"></label><label>API URL <input data-role="llm-url" type="url" value="${esc(c.url)}" placeholder="https://your-api.example/v1"></label><label>API Key <input data-role="llm-token" type="password" autocomplete="off" value="${esc(c.token)}"></label></div>
    <div class="row"><button data-action="llm-models">${ui("拉取模型")}</button><label>${ui("选择模型")} <select data-role="llm-model-list"><option value="">${ui("请选择模型")}</option>${models.map(id => `<option value="${esc(id)}" ${c.model === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label><label>${ui("模型 ID（也可手填）")}<input data-role="llm-model" value="${esc(c.model)}"></label></div>
    <p class="sub">${ui("OpenAI 兼容接口，填写后自动保存，所有聊天共用。启用后会把所选正文发送给该服务，每层最多读取末尾6000字。")}</p><p role="status">${esc(status)}</p>
    <details><summary>${ui("配置恢复")}</summary><button data-action="llm-settings-backup">${ui("备份原配置（含Key）")}</button><button data-action="llm-settings-reset">${ui("重置选项并保留连接")}</button><button data-action="llm-settings-clear">${ui("清空副API配置和Key")}</button></details>
  </section>`;
}
