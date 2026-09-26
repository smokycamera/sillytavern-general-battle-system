import { TRAITS } from './traits.js';

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
  'magic-area': ['范围魔法', '范围法术', '法术范围', '魔法范围伤害', '魔法群攻', '法术群攻', 'magic aoe', 'magic-area'],
  buff: ['buff', '增益', '增益技能', '强化', '强化技能'], debuff: ['debuff', '减益', '减益技能', '负面', '负面状态'],
};
export const SKILL_MODIFIER_ALIASES: Record<string, string[]> = {
  melee: ['近身', '近战技法'], ranged: ['远射', '远程射击'], shield: ['盾击'], projectile: ['动能投射', '远程投射'],
  thermal: ['火焰', '热伤'], arcane: ['奥术伤害'], martial: ['非魔法', '物理技法'],
  attack: ['提高攻击', '攻击提升', '提高命中', '命中提升'], defense: ['提高防御', '防御提升'],
  empower: ['提高伤害', '伤害提升', '强击'], ward: ['护盾', '防护', '减伤'], haste: ['提速', '迅捷'],
  heal: ['治疗术', '恢复生命', '疗伤', '治愈', '医疗'], cleanse: ['解除负面', '清除减益', '驱除减益'],
  restore: ['恢复能量', '能量恢复'], summon: ['召唤造物'], 'morale-up': ['提高士气', '鼓舞士气'],
  weaken: ['削弱'], 'accuracy-down': ['降低攻击', '降低命中', '失准'], 'defense-down': ['降低防御', '破绽'],
  vulnerable: ['增伤易伤'], slow: ['迟缓', '减速术'], root: ['束缚', '禁锢', '缠绕'], stun: ['晕眩', '震慑'],
  disarm: ['解除武装'], silence: ['禁言', '封魔'], fear: ['恐惧', '恐吓'], 'morale-down': ['降低士气', '打击士气'],
  demoralize: ['士气低落', '沮丧'], wound: ['伤势恶化'], poison: ['毒伤', '毒素'], bleed: ['出血'], burn: ['灼烧', '烧伤'],
  dispel: ['解除增益', '驱除增益'], drain: ['消耗能量', '能量削减'], push: ['推开', '推离'], pull: ['拉近', '牵引'],
};
export interface SkillMechanism { category: SkillCategory; area: boolean; modifiers: string[] }
export interface SkillRecipe extends SkillMechanism { version: 'skill-formula-v1' | 'skill-formula-v2'; power: number }
export interface SkillModifier { id: string; name: string; allowed: 'damage' | 'physical' | 'magic' | 'buff' | 'hostile' | 'support'; condition?: string; trait?: string }
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
  { id: 'morale-up', name: '士气', allowed: 'buff' },
  { id: 'weaken', name: '虚弱', allowed: 'hostile', condition: 'weakened' },
  { id: 'accuracy-down', name: '攻击', allowed: 'hostile', condition: 'inaccurate' },
  { id: 'defense-down', name: '防御', allowed: 'hostile', condition: 'exposed' },
  { id: 'vulnerable', name: '易伤', allowed: 'hostile', condition: 'vulnerable' },
  { id: 'slow', name: '减速', allowed: 'hostile', condition: 'slowed' },
  { id: 'root', name: '定身', allowed: 'hostile', condition: 'restrained' },
  { id: 'stun', name: '眩晕', allowed: 'hostile', condition: 'stunned' },
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
  ...TRAITS.filter((t) => t.v2SourceReady).map((t): SkillModifier => ({ id: 'trait-' + t.id, name: '特质' + t.name, allowed: 'buff', trait: t.id })),
];
export function allowedSkillModifiers(category: SkillCategory): SkillModifier[] {
  const physical = category.startsWith('physical'), magic = category.startsWith('magic'), damage = physical || magic;
  return SKILL_MODIFIERS.filter((m) => m.allowed === 'support' ? !damage : m.allowed === 'buff' ? category === 'buff' : m.allowed === 'hostile' ? category !== 'buff'
    : m.allowed === 'physical' ? physical : m.allowed === 'magic' ? magic : damage);
}
export function skillMechanismId(mechanism: SkillMechanism): string {
  return 'generic:' + mechanism.category + (mechanism.area && !mechanism.category.endsWith('area') ? ':area' : '')
    + (mechanism.modifiers.length ? ':' + [...mechanism.modifiers].sort().join('+') : '');
}
export function skillMechanismFromId(id: string): SkillMechanism | undefined {
  if (!id.startsWith('generic:')) return undefined;
  const parts = id.slice(8).split(':'), category = parts.shift() as SkillCategory;
  if (!SKILL_CATEGORIES.some((c) => c.id === category)) return undefined;
  const area = category.endsWith('area') || parts[0] === 'area'; if (parts[0] === 'area') parts.shift();
  if (parts.length > 1) return undefined;
  const modifiers = parts[0]?.split('+') ?? [], allowed = allowedSkillModifiers(category);
  if (modifiers.length > 3 || new Set(modifiers).size !== modifiers.length || modifiers.some((id) => !allowed.some((m) => m.id === id))) return undefined;
  if (['melee', 'ranged', 'shield', 'projectile'].filter((id) => modifiers.includes(id)).length > 1 || ['thermal', 'arcane'].every((id) => modifiers.includes(id))) return undefined;
  if (modifiers.some(id => id.startsWith('zone-')) && modifiers.length !== 1) return undefined;
  if (modifiers.filter(id => ['cone','line','ring','chain'].includes(id)).length > 1) return undefined;
  if (modifiers.includes('summon') && (area || modifiers.length > 1)) return undefined;
  return { category, area, modifiers };
}
/** 通用机制直接解析；自定义名称不进入机制推断，不匹配预制技能名。 */
export function parseSkillMechanism(text: string): SkillMechanism | undefined {
  const controls:Record<string,string> = {眩晕:'stun',定身:'root',沉默:'silence',缴械:'disarm',减速:'slow',惊惧:'fear',击退:'push',拉拽:'pull'};
  const simple:Record<string,[SkillCategory,string]> = {屏障:['buff','barrier'],治疗:['buff','heal'],净化:['buff','cleanse'],回能:['buff','restore'],火墙:['magic-area','zone-fire'],毒雾:['magic-area','zone-poison'],烟幕:['buff','zone-smoke'],治疗区域:['buff','zone-healing'],陷阱:['debuff','zone-trap']};
  const short = text.trim().replace(/^控制[：:]?/, '');
  if(simple[short]) { const [category,id]=simple[short]!;return {category,area:category.endsWith('area'),modifiers:[id]}; }
  if(controls[short]) return {category:'debuff',area:false,modifiers:[controls[short]!]};
  let source = text.trim().replace(/^(?:范围|群体)(buff|debuff|增益|减益)/i, '$1范围');
  const prefix = SKILL_CATEGORIES.flatMap((c) => [c.name, ...SKILL_CATEGORY_ALIASES[c.id]].map((name) => ({ id: c.id, name })))
    .sort((a, b) => b.name.length - a.name.length).find((c) => source.toLowerCase().startsWith(c.name.toLowerCase()));
  if (!prefix) return undefined;
  const category = prefix.id;
  source = source.slice(prefix.name.length).trim();
  const areaWord = source.match(/^(?:群体范围|范围|群体)/)?.[0];
  const area = category.endsWith('area') || !!areaWord; if (areaWord) source = source.slice(areaWord.length);
  const modifiers: string[] = [], choices = allowedSkillModifiers(category).flatMap((m) => [m.name, ...(SKILL_MODIFIER_ALIASES[m.id] ?? []), ...(m.trait ? [m.name.slice(2)] : [])].map((name) => ({ id: m.id, name }))).sort((a, b) => b.name.length - a.name.length);
  while (source) {
    source = source.replace(/^[+\s]+/, ''); if (!source) break;
    const modifier = choices.find((m) => source.startsWith(m.name)); if (!modifier) return undefined;
    modifiers.push(modifier.id); source = source.slice(modifier.name.length);
  }
  return skillMechanismFromId(skillMechanismId({ category, area, modifiers }));
}
export function skillMechanismName(value: SkillMechanism | string): string {
  const mechanism = typeof value === 'string' ? skillMechanismFromId(value) : value;
  if (!mechanism) return '';
  return SKILL_CATEGORIES.find((c) => c.id === mechanism.category)!.name
    + (mechanism.area && !mechanism.category.endsWith('area') ? '范围' : '')
    + mechanism.modifiers.map((id) => SKILL_MODIFIERS.find((m) => m.id === id)!.name).join('+');
}
