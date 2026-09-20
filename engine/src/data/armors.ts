/**
 * 护甲原型库：与武器生成机制同构——原型参数（drScale 减伤效率）× 规则包护甲表 → 公式生成，
 * 生成时 ±0.05 浮动并写入审计。术语与数值同源：板甲减伤扎实、防弹衣挡不住步枪弹。
 *
 * 实际减伤 = 规则包 armorDR[tier] × drScale（体系包的时代差异与单位护甲的个体差异两层叠加）。
 */

export interface ArmorProfile {
  id: string;
  name: string;
  /** 减伤效率乘数：1 = 规则包基准；防弹衣 0.6（挡破片不挡步枪）、动力甲 1.15 */
  drScale: number;
  /** 基准护甲档；缺省沿用原型基准+浮动 */
  tier?: 0 | 1 | 2 | 3 | 4;
  desc?: string;
}

export const ARMOR_LIBRARY: Record<string, ArmorProfile> = {
  // ---- 冷兵器时代（基准 1.0，兼容既有生成） ----
  'arm-gambeson': { id: 'arm-gambeson', name: '软甲', drScale: 1, desc: '毡衬布甲，聊胜于无' },
  'arm-mail': { id: 'arm-mail', name: '锁子甲', drScale: 1.05, desc: '环环相扣的灵活防护' },
  'arm-plate': { id: 'arm-plate', name: '板甲', drScale: 1.1, desc: '淬火钢板的绝对信任' },

  // ---- 火药时代（甲胄让位于火力） ----
  'arm-uniform': { id: 'arm-uniform', name: '军装', drScale: 0.9, desc: '布料与勇气' },
  'arm-cuirass': { id: 'arm-cuirass', name: '胸甲', drScale: 1.05, desc: '最后一代甲骑兵团的执念' },

  // ---- 现代战争（软质防弹材料对步枪弹乏力） ----
  'arm-vest': { id: 'arm-vest', name: '防弹衣', drScale: 0.7, desc: '挡得住破片与手枪弹' },
  'arm-heavy-vest': { id: 'arm-heavy-vest', name: '重装防弹衣', drScale: 0.9, desc: '插板加身的负重' },

  // ---- 星际战争 ----
  'arm-composite': { id: 'arm-composite', name: '复合装甲', drScale: 1.05 },
  'arm-power': { id: 'arm-power', name: '动力甲', drScale: 1.15, desc: '伺服关节承载的堡垒' },

  // ---- 体系特化（armorId 显式引用） ----
  'arm-flak': { id: 'arm-flak', name: '防爆服', drScale: 0.75, desc: '卫队标准配发' },
  'arm-subdermal': { id: 'arm-subdermal', name: '皮下装甲', drScale: 0.5, desc: '植入肌肉间的合金网' },
  'arm-arament': { id: 'arm-arament', name: '阿斯塔特动力甲', drScale: 1.2, desc: '圣血与钢铁的融合' },
  'arm-terminator': { id: 'arm-terminator', name: '终结者甲', drScale: 1.25, desc: '战术无畏动力甲：信仰浇铸的移动堡垒' },
};

export function getArmorProfile(id?: string): ArmorProfile | undefined {
  return id ? ARMOR_LIBRARY[id] : undefined;
}
