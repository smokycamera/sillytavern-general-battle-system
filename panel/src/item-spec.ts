import { parseEnhancementSuffix, enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, resolveWeaponClass, type BodyKind, type ItemSpecification } from '../../engine/src/index.js';

export function itemSpecificationLabel(spec: ItemSpecification): string {
  const name = spec.kind === 'weapon' ? WEAPON_CLASSES[spec.mechanism]?.name ?? spec.mechanism
    : spec.kind === 'armor' ? ['无甲', '轻甲', '中甲', '重甲', '超重甲'][spec.tier] : spec.kind === 'shield' ? '盾牌' : '治疗';
  return `${name}L${spec.power}${enhancementLabel(spec.bonuses)}${spec.kind === 'weapon' && spec.enchantment && spec.enchantment !== 'none' ? ' · ' + (spec.enchantment === 'arcane' ? '奥术转化' : '热能转化') : ''}`;
}

/** 正文仅提供机制与规格；属性、骰子、身份、种子与版本仍由插件计算。 */
export function parseItemSpecification(text: string, attrs: { type?: string; quality?: string; body?: string; enchant?: string; stabilized?: string; protection?: string } = {}): ItemSpecification {
  const kind = /^(?:无甲|轻甲|中甲|重甲|超重甲)/.test(text) ? 'armor' : /^(?:盾|shield)/.test(text) ? 'shield' : /^(?:治疗|heal)/.test(text) ? 'consumable' : 'weapon';
  const parsed = parseEnhancementSuffix(text,kind);
  const match = parsed.text.trim().match(/^([^:：|]+?)[lL](\d{1,2})$/);
  if (!match) throw new Error('物品规格使用“机制L强度”，例如火炮L7、重甲L5、治疗L3');
  const name = match[1]!.trim(), power = Number(match[2]);
  if (power < 1 || power > 10) throw new Error('物品强度必须为1–10');
  const quality = attrs.quality === undefined ? undefined : Number(attrs.quality);
  if (quality !== undefined && (!/^\d+$/.test(attrs.quality!) || !Number.isInteger(quality) || quality < 1 || quality > 5)) throw new Error('品质必须为1–5');
  if (attrs.body !== undefined && !['human', 'large', 'vehicle', 'giant'].includes(attrs.body)) throw new Error('未知物品体量');
  const base = { bonuses: parsed.bonuses, power, ...(quality === undefined ? {} : { quality }), ...(attrs.body === undefined ? {} : { body: attrs.body as BodyKind }) };
  if (attrs.stabilized !== undefined && !['true', 'false'].includes(attrs.stabilized)) throw new Error('stabilized 必须是 true/false');
  if (attrs.protection !== undefined && !['balanced', 'kinetic', 'thermal', 'arcane'].includes(attrs.protection)) throw new Error('未知防护构型');
  const weaponId = resolveWeaponClass(name), weapon = weaponId ? WEAPON_CLASSES[weaponId] : undefined;
  let spec: ItemSpecification;
  if (weapon) {
    if (attrs.protection !== undefined) throw new Error('防护构型只适用于护甲');
    if (attrs.enchant !== undefined && !['none', 'thermal', 'arcane'].includes(attrs.enchant)) throw new Error('未知附魔机制');
    spec = { kind: 'weapon', mechanism: weapon.id, ...base, ...(attrs.stabilized === undefined ? {} : { stabilized: attrs.stabilized === 'true' }), ...(attrs.enchant === undefined ? {} : { enchantment: attrs.enchant as 'none' | 'thermal' | 'arcane' }) };
  } else {
    if (attrs.stabilized !== undefined) throw new Error('稳定装置只适用于车载武器');
    if (attrs.enchant !== undefined) throw new Error('此附魔字段只适用于武器');
    const tier = ['无甲', '轻甲', '中甲', '重甲', '超重甲'].indexOf(name);
    if (tier >= 0) spec = { kind: 'armor', tier: tier as 0 | 1 | 2 | 3 | 4, ...base, ...(attrs.protection === undefined ? {} : { profile: attrs.protection as 'balanced' | 'kinetic' | 'thermal' | 'arcane' }) };
    else if (['盾', '盾牌', 'shield'].includes(name)) spec = { kind: 'shield', ...base };
    else if (['治疗', 'heal'].includes(name)) spec = { kind: 'consumable', mechanism: 'heal', ...base };
    else throw new Error('未知物品机制，不能按陌生名字推断能力');
  }
  if (attrs.protection !== undefined && spec.kind !== 'armor') throw new Error('防护构型只适用于护甲');
  const type = spec.kind === 'shield' ? 'armor' : spec.kind;
  if (attrs.type !== undefined && attrs.type !== type) throw new Error('物品种类与机械规格冲突');
  return spec;
}
