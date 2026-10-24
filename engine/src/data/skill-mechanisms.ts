import { canonicalTraitId, TRAIT_LEVEL_ALIASES } from '../trait-parameters.js';
import { TRAITS, TRAIT_FORMER_NAMES } from './traits.js';
import type { Ability, EffectOp } from '../types.js';

export const SKILL_CATEGORIES = [
  { id: 'physical-single', name: '物理单体' }, { id: 'physical-area', name: '物理范围' },
  { id: 'magic-single', name: '魔法单体' }, { id: 'magic-area', name: '魔法范围' },
  { id: 'buff', name: '增益' }, { id: 'debuff', name: '减益' },
] as const;
export type SkillCategory = typeof SKILL_CATEGORIES[number]['id'];
export const SKILL_CATEGORY_ALIASES: Record<SkillCategory, string[]> = {
  'physical-single': ['单体物理', '物理单体伤害', '单体物理伤害', '物理单攻', 'physical single', 'physical-single'],
  'physical-area': ['范围物理', '物理范围伤害', '范围物理伤害', '物理群攻', '物理群体', 'physical aoe', 'physical-area'],
  'magic-single': ['单体魔法', '单体法术', '法术单体', '魔法单体伤害', '法术单攻', 'magic single', 'magic-single'],
  'magic-area': ['范围魔法', '范围法术', '法术范围', '魔法范围伤害', '魔法群攻', '法术群攻', '群体魔法', '群体法术', '魔法群体', 'magic aoe', 'magic-area'],
  buff: ['buff', '增益', '增益技能', '强化', '强化技能'], debuff: ['debuff', '减益', '减益技能', '负面', '负面状态'],
};
export const SKILL_MODIFIER_ALIASES: Record<string, string[]> = {
  melee: ['近身', '近战技法'], ranged: ['远射', '远程射击'], shield: ['盾击'], projectile: ['动能投射', '远程投射'],
  thermal: ['火焰', '热伤'], arcane: ['奥术伤害'], martial: ['非魔法', '物理技法'],
  attack: ['提高攻击', '攻击提升', '提高命中', '命中提升'], defense: ['提高防御', '防御提升'],
  empower: ['提高伤害', '伤害提升', '强击'], ward: ['减伤'], barrier: ['护盾', '防护'], haste: ['提速', '迅捷'],
  heal: ['治疗术', '恢复生命', '疗伤', '治愈', '医疗'], cleanse: ['解除负面', '清除减益', '驱除减益'],
  restore: ['恢复能量', '能量恢复'], summon: ['召唤造物'], 'morale-up': ['提高士气', '鼓舞士气'],
  weaken: ['削弱'], 'accuracy-down': ['降低攻击', '降低命中', '失准'], 'defense-down': ['降低防御', '破绽'],
  vulnerable: ['增伤易伤'], slow: ['迟缓', '减速术'], root: ['束缚', '禁锢', '缠绕'], stun: ['晕眩', '震慑'],
  disarm: ['解除武装'], silence: ['禁言', '封魔'], fear: ['恐惧', '恐吓'], 'morale-down': ['降低士气', '打击士气'],
  demoralize: ['士气低落', '沮丧'], wound: ['伤势恶化'], poison: ['毒伤', '毒素'], bleed: ['出血'], burn: ['灼烧', '烧伤'],
  dispel: ['解除增益', '驱除增益'], drain: ['消耗能量', '能量削减'], push: ['推开', '推离'], pull: ['拉近', '牵引'],
  dash: ['冲锋', '冲刺', '突击', '飞扑', '扑击', '前冲'], blink: ['瞬移', '传送', '闪烁', '瞬步', '缩地', '影步'],
  withdraw: ['撤步', '后跳', '跃退', '脱离', '翻滚', '后退'],
};
export interface SkillMechanism { category: SkillCategory; area: boolean; modifiers: string[]; categoryPower?: number; modifierPowers?: Record<string, number> }
/** 施术者自身位移的效果词。 */
export const MOVEMENT_MODIFIERS: readonly string[] = ['dash', 'blink', 'withdraw'];
export interface SkillRecipe extends SkillMechanism { version: 'skill-formula-v1' | 'skill-formula-v2' | 'skill-formula-v3'; power: number }
export interface SkillModifier { id: string; name: string; allowed: 'damage' | 'physical' | 'magic' | 'buff' | 'hostile' | 'support' | 'any'; condition?: string; trait?: string }
export const SKILL_MODIFIERS: SkillModifier[] = [
  { id: 'melee', name: '近战', allowed: 'physical' }, { id: 'ranged', name: '射击', allowed: 'physical' },
  { id: 'shield', name: '盾牌', allowed: 'physical' }, { id: 'projectile', name: '投射', allowed: 'physical' },
  { id: 'thermal', name: '热能', allowed: 'magic' }, { id: 'arcane', name: '奥术', allowed: 'magic' },
  { id: 'martial', name: '战技', allowed: 'support' },
  { id: 'attack', name: '攻击', allowed: 'buff', condition: 'inspired' },
  { id: 'defense', name: '防御', allowed: 'buff', condition: 'encouraged' },
  { id: 'empower', name: '伤害', allowed: 'buff', condition: 'empowered' },
  { id: 'ward', name: '守护', allowed: 'buff', condition: 'blessed' },
  { id: 'haste', name: '加速', allowed: 'buff', condition: 'hasted' },
  { id: 'confidence', name: '振奋', allowed: 'buff', condition: 'confident' },
  { id: 'heal', name: '治疗', allowed: 'buff' }, { id: 'cleanse', name: '净化', allowed: 'buff' },
  { id: 'cone', name: '扇形', allowed: 'damage' }, { id: 'line', name: '直线', allowed: 'damage' },
  { id: 'ring', name: '环形', allowed: 'damage' }, { id: 'chain', name: '连锁', allowed: 'damage' },
  { id: 'zone-fire', name: '火墙', allowed: 'magic' }, { id: 'zone-poison', name: '毒雾', allowed: 'magic' },
  { id: 'zone-trap', name: '陷阱', allowed: 'hostile' }, { id: 'zone-smoke', name: '烟幕', allowed: 'buff' }, { id: 'zone-healing', name: '治疗区域', allowed: 'buff' },
  { id: 'barrier', name: '屏障', allowed: 'buff' },
  { id: 'restore', name: '回能', allowed: 'buff' }, { id: 'summon', name: '召唤', allowed: 'buff' },
  { id: 'summon-single', name: '单体召唤', allowed: 'buff' }, { id: 'summon-group', name: '群体召唤', allowed: 'buff' },
  { id: 'morale-up', name: '士气', allowed: 'buff' },
  { id: 'weaken', name: '虚弱', allowed: 'hostile', condition: 'weakened' },
  { id: 'accuracy-down', name: '攻击', allowed: 'hostile', condition: 'inaccurate' },
  { id: 'defense-down', name: '防御', allowed: 'hostile', condition: 'exposed' },
  { id: 'vulnerable', name: '易伤', allowed: 'hostile', condition: 'vulnerable' },
  { id: 'slow', name: '减速', allowed: 'hostile', condition: 'slowed' },
  { id: 'root', name: '定身', allowed: 'hostile', condition: 'restrained' },
  { id: 'stun', name: '眩晕', allowed: 'hostile', condition: 'stunned' },
  { id: 'taunt', name: '嘲讽', allowed: 'hostile', condition: 'taunted' },
  { id: 'blind', name: '致盲', allowed: 'hostile', condition: 'blinded' },
  { id: 'confuse', name: '混乱', allowed: 'hostile', condition: 'confused' },
  { id: 'charm', name: '魅惑', allowed: 'hostile', condition: 'charmed' },
  { id: 'disarm', name: '缴械', allowed: 'hostile', condition: 'disarmed' },
  { id: 'silence', name: '沉默', allowed: 'hostile', condition: 'silenced' },
  { id: 'curse', name: '诅咒', allowed: 'hostile', condition: 'cursed' },
  { id: 'fear', name: '惊惧', allowed: 'hostile', condition: 'fearful' },
  { id: 'morale-down', name: '士气', allowed: 'hostile' },
  { id: 'demoralize', name: '士气低下', allowed: 'hostile', condition: 'demoralized' },
  { id: 'wound', name: '重伤', allowed: 'hostile', condition: 'wounded' },
  { id: 'poison', name: '中毒', allowed: 'hostile', condition: 'poisoned' },
  { id: 'bleed', name: '流血', allowed: 'hostile', condition: 'bleeding' },
  { id: 'burn', name: '燃烧', allowed: 'hostile', condition: 'burning' },
  { id: 'dispel', name: '驱散', allowed: 'hostile' }, { id: 'drain', name: '耗能', allowed: 'hostile' },
  { id: 'push', name: '击退', allowed: 'hostile' }, { id: 'pull', name: '拉拽', allowed: 'hostile' },
  // 施术者自身位移：突进、闪现在效果之前，后撤在效果之后；任何类别都可附加。
  { id: 'dash', name: '突进', allowed: 'any' }, { id: 'blink', name: '闪现', allowed: 'any' }, { id: 'withdraw', name: '后撤', allowed: 'any' },
  ...TRAITS.filter((t) => t.v2SourceReady).map((t): SkillModifier => ({ id: 'trait-' + t.id, name: '特质' + t.name, allowed: 'buff', trait: t.id })),
];
const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
/** 停用特质与身体/装备特质只为旧技能的 id 保留，新技能不能再选。 */
const retiredTraitModifier = (m: SkillModifier) => !!m.trait && !!(TRAIT_BY_ID.get(m.trait)?.legacy || TRAIT_BY_ID.get(m.trait)?.derived);
/** 新技能不再授予的特质：先锋部署只在开战部署时生效，战中授予没有作用；守护、大守护与随等级缩放的增益守护是同一种减伤，
 *  写成技能效果时改用增益守护。已学技能的旧 id 照常结算。 */
export const SKILL_GRANT_REPLACEMENTS: Readonly<Record<string, string | undefined>> = { 'trait-vanguard': undefined, 'trait-guardian': 'ward', 'trait-guardian-greater': 'ward' };
const offeredModifier = (m: SkillModifier) => !retiredTraitModifier(m) && !(m.trait && TRAIT_LEVEL_ALIASES[m.trait]) && !(m.id in SKILL_GRANT_REPLACEMENTS);
function modifierAllowed(m: SkillModifier, category: SkillCategory): boolean {
  const physical = category.startsWith('physical'), magic = category.startsWith('magic'), damage = physical || magic;
  return m.allowed === 'any' || (m.allowed === 'support' ? !damage : m.allowed === 'buff' ? category === 'buff' : m.allowed === 'hostile' ? category !== 'buff'
    : m.allowed === 'physical' ? physical : m.allowed === 'magic' ? magic : damage);
}
/** 召唤、烟幕、治疗区域与陷阱按阵营或在施术者身旁生效，与技能目标是谁无关，任何类别都可以附带。 */
const SIDE_AWARE = new Set(['summon', 'summon-single', 'summon-group', 'zone-smoke', 'zone-healing', 'zone-trap']);
/** 作用在目标身上的效果与类别方向相反：攻击/减益技能附带治疗、增益或授予特质会给敌人，增益技能附带伤害或控制会打在友军身上。 */
function polarityConflict(m: SkillModifier, category: SkillCategory): boolean {
  return !SIDE_AWARE.has(m.id) && (category === 'buff' ? m.allowed === 'hostile' : m.allowed === 'buff');
}
export function allowedSkillModifiers(category: SkillCategory): SkillModifier[] {
  return SKILL_MODIFIERS.filter((m) => offeredModifier(m) && modifierAllowed(m, category));
}
/** 结构参数仍只有一个槽位；冲突时采用最后声明，效果词本身全部保留。突进与闪现都是出手前的接近方式，同样只取一个。 */
function normalizeModifiers(input: string[]): string[] {
  const groups=[['melee','ranged','shield','projectile'],['thermal','arcane'],['cone','line','ring','chain'],['summon','summon-single','summon-group'],['dash','blink']];
  return [...new Set(input)].filter(id=>!groups.some(group=>group.includes(id)&&[...input].reverse().find(value=>group.includes(value))!==id));
}
export function skillMechanismId(mechanism: SkillMechanism): string {
  return 'generic:' + mechanism.category + (mechanism.categoryPower ? '@' + mechanism.categoryPower : '') + (mechanism.area && !mechanism.category.endsWith('area') ? ':area' : '')
    + (mechanism.modifiers.length ? ':' + normalizeModifiers(mechanism.modifiers).sort().map(id => id + (mechanism.modifierPowers?.[id] ? '@' + mechanism.modifierPowers[id] : '')).join('+') : '');
}
export function skillMechanismFromId(id: string): SkillMechanism | undefined {
  if (!id.startsWith('generic:')) return undefined;
  const parts = id.slice(8).split(':'), categoryPart = parts.shift()!.split('@'), category = categoryPart[0] as SkillCategory;
  const validPower = (value: string | undefined) => value === undefined || /^(?:[1-9]|10)$/.test(value);
  if (categoryPart.length > 2 || !validPower(categoryPart[1])) return undefined;
  if (!SKILL_CATEGORIES.some((c) => c.id === category)) return undefined;
  const area = category.endsWith('area') || parts[0] === 'area'; if (parts[0] === 'area') parts.shift();
  if (parts.length > 1) return undefined;
  const tokens = parts[0]?.split('+').map(part => part.split('@')) ?? [];
  if (tokens.some(token => token.length > 2 || !validPower(token[1]))) return undefined;
  const modifiers = normalizeModifiers(tokens.map(token => token[0]!));
  const modifierPowers = Object.fromEntries(modifiers.flatMap(key => { const value = tokens.filter(token => token[0] === key).at(-1)?.[1]; return value ? [[key, Number(value)]] : []; }));
  if (modifiers.some((id) => !SKILL_MODIFIERS.some((m) => m.id === id))) return undefined;
  return { category, area, modifiers, ...(categoryPart[1] ? { categoryPower: Number(categoryPart[1]) } : {}), ...(Object.keys(modifierPowers).length ? { modifierPowers } : {}) };
}
const CHARGE_WORDS = ['冲锋', '突击', '飞扑', '扑击'];
/** 单词简写展开为完整机制：控制词默认减益；冲锋类默认以实际近战武器出手；单写位移词只移动自己。 */
const SHORTHAND: Record<string, [SkillCategory, ...string[]]> = {
  单体召唤: ['buff', 'summon-single'], 群体召唤: ['buff', 'summon-group'], 召唤: ['buff', 'summon'], 屏障: ['buff', 'barrier'], 治疗: ['buff', 'heal'],
  净化: ['buff', 'cleanse'], 回能: ['buff', 'restore'], 火墙: ['magic-area', 'zone-fire'], 毒雾: ['magic-area', 'zone-poison'], 烟幕: ['buff', 'zone-smoke'],
  治疗区域: ['buff', 'zone-healing'], 陷阱: ['debuff', 'zone-trap'],
  眩晕: ['debuff', 'stun'], 定身: ['debuff', 'root'], 沉默: ['debuff', 'silence'], 缴械: ['debuff', 'disarm'], 减速: ['debuff', 'slow'], 惊惧: ['debuff', 'fear'],
  击退: ['debuff', 'push'], 拉拽: ['debuff', 'pull'], 魅惑: ['debuff', 'charm'],
  冲锋: ['physical-single', 'melee', 'dash'], 突击: ['physical-single', 'melee', 'dash'], 飞扑: ['physical-single', 'melee', 'dash'], 扑击: ['physical-single', 'melee', 'dash'],
  ...Object.fromEntries(([['dash', '突进', '冲刺', '前冲'], ['blink', '闪现', ...SKILL_MODIFIER_ALIASES.blink!], ['withdraw', '后撤', ...SKILL_MODIFIER_ALIASES.withdraw!]] as string[][])
    .flatMap(([id, ...words]) => words.map((word) => [word, ['buff', id!]]))),
};
/** 剔除原因：deployment 开战部署才生效；retired 停用特质；enemy 友方效果写进攻击/减益会作用到敌人；ally 伤害/控制写进增益会作用到友军。 */
export type DroppedSkillWord = { name: string; reason: 'deployment' | 'retired' | 'enemy' | 'ally' };
export interface SkillMechanismParts { mechanism?: SkillMechanism; dropped: DroppedSkillWord[]; replaced: [string, string][] }
/** 宽松解析：识别全部登记词，再剔除在该类别不能成立的效果，例如攻击技能里的治疗只会治疗被打的敌人、增益技能里的眩晕会晕倒友军。
 *  正文容错据此给出诊断；面板与正文的严格解析只接受没有剔除的写法。 */
export function parseSkillMechanismParts(text: string): SkillMechanismParts | undefined {
  const short = text.trim().replace(/^控制[：:]?/, '');
  const expand = (word: string) => { const [category, ...ids] = SHORTHAND[word]!; return [SKILL_CATEGORIES.find((c) => c.id === category)!.name, ...ids.map((id) => SKILL_MODIFIERS.find((m) => m.id === id)!.name)].join('+'); };
  let source = SHORTHAND[short] ? expand(short) : text.trim().replace(/^(?:范围|群体)\s*\+?\s*魅惑/, '减益范围+魅惑').replace(/^(?:范围|群体)(buff|debuff|增益|减益)/i, '$1范围');
  const shorthand = Object.keys(SHORTHAND).sort((a, b) => b.length - a.length).find(name => source.startsWith(name + '+'));
  if (shorthand) source = expand(shorthand) + source.slice(shorthand.length);
  const prefix = SKILL_CATEGORIES.flatMap((c) => [c.name, ...SKILL_CATEGORY_ALIASES[c.id]].map((name) => ({ id: c.id, name })))
    .sort((a, b) => b.name.length - a.name.length).find((c) => source.toLowerCase().startsWith(c.name.toLowerCase()));
  if (!prefix) return undefined;
  const category = prefix.id;
  source = source.slice(prefix.name.length).trim();
  const readPower = () => {
    const token = source.match(/^[lL]\s*(\d+)/);
    if (!token) return undefined;
    const power = Number(token[1]);
    if (!Number.isInteger(power) || power < 1 || power > 10) throw Error('技能等级必须是L1–L10整数');
    source = source.slice(token[0].length).trimStart();
    return power;
  };
  const categoryPower = readPower(), modifierPowers: Record<string, number> = {};
  const areaWord = source.match(/^(?:群体范围|范围|群体(?!召唤))/)?.[0];
  const area = category.endsWith('area') || !!areaWord; if (areaWord) source = source.slice(areaWord.length);
  const preferred = allowedSkillModifiers(category);
  // 停用特质与身体/装备特质只保留旧技能 id 的结算，新写法识别后剔除；改名特质的旧称照样识别。
  const found: SkillModifier[] = [], choices = [...preferred, ...SKILL_MODIFIERS.filter(m => !preferred.includes(m))]
    .flatMap((m) => [m.name, ...(SKILL_MODIFIER_ALIASES[m.id] ?? []), ...(m.trait ? [m.name.slice(2), ...(TRAIT_FORMER_NAMES[m.trait] ?? [])] : [])].map((name) => ({ modifier: m, name }))).sort((a, b) => b.name.length - a.name.length);
  let charge = false;
  while (source) {
    source = source.replace(/^[+\s]+/, ''); if (!source) break;
    const choice = choices.find((m) => source.startsWith(m.name)); if (!choice) return undefined;
    found.push(choice.modifier); source = source.slice(choice.name.length).trimStart();
    const power = readPower();
    if (power !== undefined) modifierPowers[choice.modifier.id] = power;
    charge ||= CHARGE_WORDS.includes(choice.name);
  }
  // 冲锋类词表示贴身出手：物理技能未写投送方式时按实际近战武器。
  if (charge && category.startsWith('physical') && !found.some((m) => ['melee', 'ranged', 'shield', 'projectile'].includes(m.id))) found.unshift(SKILL_MODIFIERS.find((m) => m.id === 'melee')!);
  const modifiers: string[] = [], dropped: DroppedSkillWord[] = [], replaced: [string, string][] = [];
  const why = (m: SkillModifier): DroppedSkillWord['reason'] => m.id in SKILL_GRANT_REPLACEMENTS && !SKILL_GRANT_REPLACEMENTS[m.id] ? 'deployment' : retiredTraitModifier(m) ? 'retired'
    : m.allowed === 'buff' || m.id in SKILL_GRANT_REPLACEMENTS ? 'enemy' : 'ally';
  for (const m of found) {
    const normalized = m.trait && canonicalTraitId(m.trait) !== m.trait ? SKILL_MODIFIERS.find(r => r.trait === canonicalTraitId(m.trait!))! : m;
    const replacement = normalized.id in SKILL_GRANT_REPLACEMENTS ? SKILL_MODIFIERS.find((r) => r.id === SKILL_GRANT_REPLACEMENTS[normalized.id]!) : normalized;
    if (replacement && replacement !== m && !polarityConflict(replacement, category)) { modifiers.push(replacement.id); if (modifierPowers[m.id]) modifierPowers[replacement.id] = modifierPowers[m.id]!; replaced.push([m.name.replace(/^特质/, ''), replacement.name]); }
    else if (replacement === m && !retiredTraitModifier(m) && !polarityConflict(m, category)) modifiers.push(m.id);
    else dropped.push({ name: m.name.replace(/^特质/, ''), reason: why(m) });
  }
  // 增益/减益没有附加效果时会补默认效果；全部剔除后不能悄悄换成另一种技能。
  const effects = modifiers.filter((id) => !['melee', 'ranged', 'shield', 'projectile', 'thermal', 'arcane', 'martial', 'cone', 'line', 'ring', 'chain'].includes(id));
  if (dropped.length && !effects.length && !category.startsWith('physical') && !category.startsWith('magic')) return { dropped, replaced };
  const mechanism = skillMechanismFromId(skillMechanismId({ category, area, modifiers, categoryPower, modifierPowers }));
  return mechanism ? { mechanism, dropped, replaced } : undefined;
}
/** 通用机制直接解析；自定义名称不进入机制推断，不匹配预制技能名。与类别冲突的效果不成立。 */
export function parseSkillMechanism(text: string): SkillMechanism | undefined {
  const parsed = parseSkillMechanismParts(text);
  return parsed?.mechanism && !parsed.dropped.length ? parsed.mechanism : undefined;
}
export function skillMechanismName(value: SkillMechanism | string): string {
  const mechanism = typeof value === 'string' ? skillMechanismFromId(value) : value;
  if (!mechanism) return '';
  return SKILL_CATEGORIES.find((c) => c.id === mechanism.category)!.name + (mechanism.categoryPower ? 'L' + mechanism.categoryPower : '')
    + (mechanism.area && !mechanism.category.endsWith('area') ? '范围' : '')
    // 自身位移写在最后，读作“物理单体近战+突进”；其余顺序不变，已有技能的显示名不受影响。
    + [...mechanism.modifiers].sort((a, b) => Number(MOVEMENT_MODIFIERS.includes(a)) - Number(MOVEMENT_MODIFIERS.includes(b)))
      .map((id) => SKILL_MODIFIERS.find((m) => m.id === id)!.name + (mechanism.modifierPowers?.[id] ? 'L' + mechanism.modifierPowers[id] : '')).join('+');
}

/** Per-effect L survives rebuilding, save validation, barrier attachment and battle upgrades. */
export function skillEffectPower(ability: Pick<Ability, 'recipe' | 'power'>, effect: EffectOp): number {
  const key = effect.op === 'condition' ? SKILL_MODIFIERS.find(m => m.condition === effect.conditionId)?.id
    : effect.op === 'trait' ? SKILL_MODIFIERS.find(m => m.trait === effect.traitId)?.id
    : effect.op === 'heal' ? 'heal' : effect.op === 'barrier' ? 'barrier'
    : effect.op === 'zone' ? 'zone-' + effect.kind : effect.op === 'move' ? effect.mode : undefined;
  return (key ? ability.recipe?.modifierPowers?.[key] : undefined)
    ?? (effect.op === 'trait' && effect.traitId === 'guardian' ? ability.recipe?.modifierPowers?.ward : undefined) ?? ability.power ?? 5;
}
