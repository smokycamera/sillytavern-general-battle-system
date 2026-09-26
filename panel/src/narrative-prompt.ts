import book from '../../assets/worldbook/!通用战斗系统约束.json';
import { MAX_SCENE_UNITS } from './narrative-limits.js';

/** 导入世界书是唯一规范源；构建不再覆盖用户的内容和触发设置。 */
export const CORE_PROTOCOL = book.entries['0'].content;
export interface PromptCard { id: string; title: string; keys: string[]; content: string; constant?: boolean }
export const PROMPT_CARDS: PromptCard[] = ([['units','1'],['skills','5'],['power','8']] as const).map(([id,uid])=>{
  const entry=book.entries[uid];
  return {id,title:entry.comment.replace(/^战阵 V2 /,''),keys:entry.key,content:entry.content,constant:entry.constant};
});

export function relevantPromptCards(text: string, newScene = false): PromptCard[] {
  const normalized = text.toLowerCase();
  const selected = new Set(PROMPT_CARDS.filter(card => card.constant || card.keys.some(key => normalized.includes(key.toLowerCase()))).map(card => card.id));
  if (newScene) selected.add('units');
  if (selected.has('units') || selected.has('skills')) selected.add('power');
  return PROMPT_CARDS.filter(card => selected.has(card.id));
}

export const RUNTIME_REMINDER = `<turn_contract>
## 本次回复

依据本次战斗记录与最新状态叙述，保留{{user}}视角，无变化者合并简述；不改判、不代操作。战斗中、战果待提交或无有效事件时只写正文。仅有据可查的战外变化可在全部格式闭合后追加唯一tb块：开闭标签各一行，每行一个小写自闭合事件，属性用英文双引号，块后结束。已有id用deploy/unit_update/unit_set；unit_set可在战外明确修改全部单位数据（含经验、死亡/复活、装备、技能、强化），保留既有限制，复杂字段写data的JSON属性；其他事件不得输出JSON。新建用spawn；hero的hp是生命，company的hp是人数/车辆数，count是卡数；本场最多${MAX_SCENE_UNITS}张。
</turn_contract>`;
