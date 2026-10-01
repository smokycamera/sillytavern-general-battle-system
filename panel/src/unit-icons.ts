/** 兵种图标：24×24 的实心剪影，按单位实际装备的武器机制选择，载具与骑乘优先。
 * 只读取装备上已经记录的机制（recipe.mechanism / mechanism: 标签），不按名称猜测。 */
import type { Combatant, Weapon } from '../../engine/src/types.js';

const rot = (deg: number, body: string) => `<g transform="rotate(${deg} 12 12)">${body}</g>`;
const f = (d: string) => `<path class="f" d="${d}"/>`;
const s = (d: string, w = 1.6) => `<path class="s" stroke-width="${w}" d="${d}"/>`;
const dot = (cx: number, cy: number, r: number) => `<circle class="f" cx="${cx}" cy="${cy}" r="${r}"/>`;
/** 四角星（闪光、火花）。 */
const spark = (x: number, y: number, r: number) => f(`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`);
/** 尖头星形（流星锤头）：n 个尖，外半径 r1、内半径 r0。 */
const star = (cx: number, cy: number, n: number, r1: number, r0: number) => 'M' + Array.from({ length: n * 2 }, (_, i) => {
  const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? r0 : r1;
  return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
}).join('L') + 'Z';

export const UNIT_ICONS: Record<string, string> = {
  sword: rot(45, f('M12 -1.6L13.7 2V15.1H10.3V2Z') + f('M6.4 15.1H17.6Q18.4 15.1 18.4 15.9V16.5Q18.4 17.3 17.6 17.3H6.4Q5.6 17.3 5.6 16.5V15.9Q5.6 15.1 6.4 15.1Z') + f('M10.9 17.3H13.1V22H10.9Z') + dot(12, 23.5, 1.7)),
  axe: rot(40, f('M11 2.6H13V25H11Z') + f('M10.2 3H13.8V10H10.2Z') + f('M10.6 3.6L8.6 3C6.6 2.8 5.4 2.2 4.4 0.8C1.8 5.6 2.2 10.8 4.8 15C6.4 12.6 8.4 10.8 10.6 9.6Z')),
  spear: rot(45, f('M11.2 6.6H12.8V26.2H11.2Z') + f('M12 -2.8C14.5 1.3 14.8 4.7 13 7.2H11C9.2 4.7 9.5 1.3 12 -2.8Z') + f('M10.3 7.3H13.7V8.9H10.3Z')),
  blunt: rot(45, f('M11 9H13V24H11Z') + dot(12, 24.6, 1.5) + f(star(12, 5.2, 8, 5.9, 3.7))),
  natural: [0, 5.2, 10.4].map(dx => f(`M${12.2 + dx} 2C${10.2 + dx} 7 ${6.6 + dx} 13.8 ${2.4 + dx} 21.4C${7.8 + dx} 15.2 ${11 + dx} 9.4 ${14.4 + dx} 3.8Z`)).join(''),
  throwing: ['-24', '24'].map(a => `<g transform="rotate(${a} 12 21)">${f('M12 0.6L14.2 6.4L13 12.6H11L9.8 6.4Z') + f('M11.2 12.6H12.8V18.2H11.2Z')}<circle class="s" stroke-width="1.2" cx="12" cy="19.9" r="1.5"/></g>`).join(''),
  bow: rot(-45, s('M10 0.6C20.6 6.8 20.6 17.2 10 23.4', 2.4) + s('M10 0.6L4.8 12L10 23.4', .9) + f('M4.6 11.2H20.6V12.8H4.6Z') + f('M24.4 12L19.6 9.2V14.8Z') + f('M5.2 12L2.6 9.4H5.6L8.2 12L5.6 14.6H2.6Z')),
  'light-ranged': rot(-45, f('M5.2 11.1H18.4V12.9H5.2Z') + f('M23.2 12L17.6 8.4V15.6Z') + f('M1.4 7.6H4.6L8.4 11.1H4.4Z') + f('M1.4 16.4H4.6L8.4 12.9H4.4Z')),
  firearm: rot(-18, f('M1.2 13.6L7.6 11.2H10.6V13.4L8.2 14.4L4.4 17.4Q2.2 18.2 1.4 16.4Z') + f('M10 11.2H19.6V13H10Z') + f('M10 9.9H23.2V11.4H10Z') + f('M10.4 8.4L12.6 8.9V9.9H10.4Z') + s('M10.8 13.4Q11.8 15.6 13.2 13.4', 1.2)),
  rifle: rot(-18, f('M0.8 11H6V13.2L6.8 13.8V16H4.4L0.8 14.4Z') + f('M6 10.4H16.2V13.4H6Z') + f('M13 10.6H19.4V13H13Z') + f('M19.4 11.1H23.4V12.5H19.4Z') + f('M10.4 13.4H13.2L14.2 17.8H11.6Z') + f('M7.8 13.4H9.8L9.2 16.8H7.4Z') + f('M8.2 9.1H10.8V10.4H8.2Z')),
  'heavy-rifle': rot(-14, f('M0.6 11.4H5.6L7.2 12.4V14.8H4.8L0.6 13.8Z') + f('M5.6 10.9H14.2V13H5.6Z') + f('M14.2 11.4H23.6V12.5H14.2Z') + f('M21.2 10.7H23.8V13.2H21.2Z') + f('M6.8 7.4H13.4V9.4H6.8Z') + f('M5.6 7.8H6.8V9H5.6Z') + s('M8 9.4V10.9M12.2 9.4V10.9', 1.1) + f('M8.8 13H10.6L10.1 15.8H8.4Z') + s('M17.6 12.5L15.4 18M17.6 12.5L19.8 18', 1.3)),
  autocannon: rot(-10, f('M3.6 9.4H11.6V14.4H3.6Z') + f('M1.4 9.9H3.6V11.3H1.4Z') + f('M1.4 12.5H3.6V13.9H1.4Z') + f('M5 8.2H10.4V9.4H5Z') + `<path class="f" fill-rule="evenodd" d="M11.6 10.1H19.6V13.7H11.6ZM13.3 11.9a.8 .8 0 1 0 .01 0ZM15.6 11.9a.8 .8 0 1 0 .01 0ZM17.9 11.9a.8 .8 0 1 0 .01 0Z"/>` + f('M19.6 11.3H23.2V12.5H19.6Z') + f('M22.2 10.5H23.8V13.3H22.2Z') + f('M5.4 14.4H9.8V17.4H5.4Z')) + s('M7.6 15.8L2.8 22M7.6 15.8L12.4 22M7.6 15.8V22', 1.6),
  cannon: rot(-16, f('M3.2 9.4Q2 9.4 2 10.8V13.2Q2 14.6 3.2 14.6L21.2 13.3V10.7Z') + f('M20.6 10.1H23.2V13.9H20.6Z') + dot(1.4, 12, 1.4)) + f('M7.8 14.6L1.6 21.2H4.6L10.6 15.6Z') + `<circle class="s" stroke-width="1.6" cx="11.6" cy="17.6" r="4.3"/>` + dot(11.6, 17.6, 1.3) + s('M11.6 13.3V21.9M7.3 17.6H15.9', .9),
  'indirect-cannon': `<g transform="rotate(40 7.6 19.6)">${f('M6.4 6.6H8.8V19.6H6.4Z')}${f('M5.9 5.4H9.3V7H5.9Z')}</g>` + f('M2.4 19.8H12.8Q13.4 21.8 11.6 21.8H3.6Q1.8 21.8 2.4 19.8Z') + s('M12.4 14.4L15.4 21.2M12.4 14.4L11.2 21.2', 1.3) + dot(17.8, 6.6, 1.1) + dot(19.7, 4.6, 1) + dot(21.7, 3.7, .9) + dot(23.3, 4.1, .75),
  energy: rot(-14, f('M1.8 11.2Q1.8 8.6 4.4 8.6H12.2Q14.4 8.6 14.4 10.8V12.6Q14.4 14.4 12.6 14.4H8.2L7.4 18H4.6L5.4 14.4H4.4Q1.8 14.4 1.8 12Z') + f('M14.4 9.6H16.2V13.4H14.4Z') + f('M16.8 10.2H18V12.8H16.8Z') + f('M18.6 10.8H19.4V12.2H18.6Z')) + f('M18.6 4.4L22.6 9.2L20.2 9.6L23.4 15L18.2 10.6L20.8 10.2Z'),
  magic: rot(32, f('M11.1 8.6H12.9V25.2H11.1Z') + s('M12 8.8C9.2 8 8.8 4.8 10.3 3M12 8.8C14.8 8 15.2 4.8 13.7 3', 1.3) + f('M12 0.4L14.1 4.3L12 7.6L9.9 4.3Z')) + spark(19.6, 3.6, 2.8) + spark(4.4, 6, 1.7) + spark(20.4, 13.6, 1.5),
  demolition: dot(10.2, 14.6, 7.2) + f('M13.6 6.6L16.8 9.8L15.2 11.4L12 8.2Z') + s('M15.9 8.4Q18.2 5 20.2 6.4', 1.4) + spark(21, 4.6, 2.6),
  summon: s('M12 12.6a1.4 1.4 0 1 1 2.8 0a4 4 0 1 1 -8 0a6.4 6.4 0 1 1 12.8 0a8.6 8.6 0 1 1 -17.2 0', 1.7) + spark(20.2, 3.8, 2.4),
  cavalry: `<path class="f" fill-rule="evenodd" d="M6.4 22.4L5.5 19.4L6.9 18.6L5.8 15.8L7.3 15.1L6.6 12.4L8.2 11.7L8 9.2L9.6 8.6L10 6.4L11 4.9L11.2 1.4L13.7 4.1C16.6 4.6 19.6 7.6 21.7 10.5C22.5 11.7 22 13.5 20.3 13.3C18.5 13.1 16.9 12.7 15.7 13.7C14.5 14.8 14.3 16.6 15.4 18.6C16.2 20 16.8 21.3 17.2 22.4ZM15.3 7.6a1 1 0 1 0 0.01 0Z"/>`,
  vehicle: `<path class="f" fill-rule="evenodd" d="M4.4 14.4H19.6Q22 14.4 22 16.8V17.6Q22 20 19.6 20H4.4Q2 20 2 17.6V16.8Q2 14.4 4.4 14.4ZM5.4 17.2a1.3 1.3 0 1 0 0.01 0ZM9.4 17.2a1.3 1.3 0 1 0 0.01 0ZM13.4 17.2a1.3 1.3 0 1 0 0.01 0ZM17.4 17.2a1.3 1.3 0 1 0 0.01 0Z"/>` + f('M3.6 14.4L5.6 11.4H18.4L20.8 14.4Z') + f('M7.8 11.4L9 8.2H14.8L16.2 11.4Z') + f('M14.8 9H23V10.4H14.8Z') + f('M10.2 8.2V7.2H12.4V8.2Z'),
  shield: `<path class="f" fill-rule="evenodd" d="M12 1.8L20.2 4.8V11C20.2 16.6 16.8 20.6 12 22.4C7.2 20.6 3.8 16.6 3.8 11V4.8ZM12 4.6L6.4 6.6V11C6.4 15 8.6 18.2 12 19.7Z"/>`,
};

export const UNIT_ICON_NAMES: Record<string, string> = {
  sword: '剑', axe: '斧', spear: '长兵器', blunt: '钝器', natural: '天生武器', throwing: '投掷', bow: '弓弩', 'light-ranged': '轻型投射',
  firearm: '火枪', rifle: '步枪', 'heavy-rifle': '重步枪', autocannon: '机炮', cannon: '直射火炮', 'indirect-cannon': '曲射火炮',
  energy: '能量武器', magic: '法杖', demolition: '爆破', summon: '召唤', cavalry: '骑乘', vehicle: '载具', shield: '其他',
};

export function weaponMechanism(weapon?: Weapon): string | undefined {
  return weapon?.recipe?.mechanism ?? weapon?.tags?.find(tag => tag.startsWith('mechanism:'))?.slice(10);
}
/** 图标键：载具 > 骑乘 > 主武器机制；旧存档无机制时，远程退回弓弩、近战退回剑。 */
export function unitIconKey(u: Pick<Combatant, 'body' | 'mount' | 'weapon'>): string {
  if (u.body === 'vehicle') return 'vehicle';
  if (u.mount) return 'cavalry';
  const mechanism = weaponMechanism(u.weapon);
  if (mechanism && UNIT_ICONS[mechanism]) return mechanism;
  if (!u.weapon) return 'shield';
  return u.weapon.tags?.includes('ranged') ? 'bow' : 'sword';
}
export function unitIcon(key: string): string {
  return `<svg class="unit-symbol" viewBox="0 0 24 24" aria-hidden="true">${UNIT_ICONS[key] ?? UNIT_ICONS.shield}</svg>`;
}
