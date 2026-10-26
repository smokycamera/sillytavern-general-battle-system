/**
 * unit_set 的 items：把道具交给单位，只增不减（收回用 take）。每一项依次取：
 * 同一回复 add 的同名道具 → 单位身上原有的同名道具（已经够数就不再添）→ 我方库存里没主的同名道具 → 新建。
 * 写了效果的只拿效果相同的那件；同一回复 add 的同名道具效果不同时各自入库。佩戴、充能道具交出时装上，
 * 编队一件就是整张卡的配发。敌方与中立单位不动我方原有库存，只拿同一回复 add 的或新建。
 */
import { itemSpecText, type ItemEffectRecipe } from '../../engine/src/index.js';
import { skillMechanismFromId, skillMechanismId } from '../../engine/src/data/skill-mechanisms.js';
import { createInventoryItem, prepareInventoryState, type InventoryItem } from './inventory-state.js';
import type { SpawnItem } from './item-spec.js';
import { itemKey } from './unit-set.js';
import type { NarrativeSave } from './narrative-state.js';

export interface HandOver { unitId: string; items: SpawnItem[]; index: number }
export interface HandOverContext {
  proposalId: string;
  /** 同一回复 add 入库的实物编号。 */
  given: ReadonlySet<string>;
  notices: string[];
}

/** 匹配时消除与主体同级的冗余标级；不改写实物配方或重编冻结效果。 */
function effectKey(spec: Pick<ItemEffectRecipe, 'form' | 'power' | 'active' | 'traits' | 'bonuses'>): string {
  const mechanism = skillMechanismFromId(spec.active ?? '');
  const active = mechanism ? skillMechanismId({ ...mechanism,
    modifiers: mechanism.modifiers.length ? mechanism.modifiers : mechanism.category === 'buff' ? ['attack','defense'] : mechanism.category === 'debuff' ? ['weaken'] : [],
    categoryPower: mechanism.categoryPower === spec.power ? undefined : mechanism.categoryPower,
    modifierPowers: Object.fromEntries(Object.entries(mechanism.modifierPowers ?? {}).filter(([,power]) => power !== spec.power)),
  }) : spec.active;
  return itemSpecText({ ...spec, active, version: 'items-v1', seed: '' });
}
const effectText = (item: InventoryItem) => item.mechanics?.kind === 'item' ? effectKey(item.mechanics.value.recipe) : undefined;
const wearable = (item: InventoryItem) => item.mechanics?.kind === 'item' && item.mechanics.value.recipe.form !== 'single';

export function handOverItems(save: NarrativeSave, handovers: HandOver[], context: HandOverContext): NarrativeSave {
  if (!handovers.length) return save;
  const next = prepareInventoryState(save) as NarrativeSave;
  const inventory = next.inventory!, moved = new Set<string>();
  const freeId = (base: string) => { let id = base; for (let n = 2; inventory.some((i) => i.id === id); n++) id = `${base}-${n}`; return id; };
  for (const { unitId, items, index } of handovers) {
    const record = next.storage?.find((r) => r.id === unitId);
    if (!record) throw new Error('要交给道具的单位不存在');
    const ally = record.side === 'ally', company = record.scale !== 'hero', parts: string[] = [];
    for (const [n, entry] of items.entries()) {
      const key = itemKey(entry.name), wanted = entry.spec ? effectKey(entry.spec) : undefined;
      const same = (item: InventoryItem) => itemKey(item.name) === key && (wanted === undefined || effectText(item) === wanted);
      const gear = entry.spec?.form === 'worn' || entry.spec?.form === 'charged';
      if (gear && company && entry.qty > 1) context.notices.push(`${record.name}是编队，佩戴、充能道具一件就是整张单位卡的配发，「${entry.name}」只交1件`);
      let need = gear && company ? 1 : entry.qty;
      /** 交出 n 件：整件或整堆直接换主人，多出的一堆拆开；佩戴、充能道具装上。 */
      const take = (item: InventoryItem): number => {
        const count = Math.min(need, item.qty);
        let target = item;
        if (count < item.qty) {
          item.qty -= count;
          target = { ...structuredClone(item), id: freeId(`${item.id}:${unitId}`), qty: count };
          inventory.push(target);
        }
        target.assignedTo = unitId;
        if (wearable(target)) target.equippedTo = { unitId, slot: 'gear' };
        moved.add(target.id); need -= count;
        return count;
      };
      // 1. 同一回复 add 的同名道具，就是要交给这个单位的那件。
      let fromGive = 0, mismatched = false;
      for (const item of inventory.filter((i) => context.given.has(i.id) && i.qty > 0 && !i.assignedTo && !i.equippedTo && itemKey(i.name) === key)) {
        if (!need) break;
        if (same(item)) fromGive += take(item); else mismatched = true;
      }
      if (mismatched && !fromGive) context.notices.push(`同一回复 add 的「${entry.name}」效果与交给${record.name}的不同，各自入库`);
      // 2. 单位原本就带着的同名道具算在内：正文重复写同一份清单不会越加越多。
      const held = inventory.filter((i) => i.assignedTo === unitId && !moved.has(i.id) && !context.given.has(i.id) && same(i)).reduce((sum, i) => sum + i.qty, 0);
      need = Math.max(0, need - held);
      // 3. 我方库存里没主的同名道具。
      let fromStash = 0;
      if (ally) for (const item of inventory.filter((i) => !context.given.has(i.id) && i.qty > 0 && !i.assignedTo && !i.equippedTo && same(i))) {
        if (!need) break;
        fromStash += take(item);
      }
      // 4. 还差的新建。
      const created = need;
      if (need) {
        const id = `handover-${context.proposalId}-${index}-${n}`;
        if (!entry.spec) inventory.push({ id: freeId(id), name: entry.name, qty: need, lootType: 'misc', assignedTo: unitId });
        else if (entry.spec.form === 'single') inventory.push({ ...createInventoryItem(freeId(id), entry.name, entry.spec, id, need), assignedTo: unitId });
        else {
          for (let piece = 0; piece < need; piece++) {
            const pieceId = freeId(need === 1 ? id : `${id}-${piece}`);
            inventory.push({ ...createInventoryItem(pieceId, entry.name, entry.spec, pieceId), assignedTo: unitId, equippedTo: { unitId, slot: 'gear' } });
          }
        }
        need = 0;
      }
      const total = fromGive + fromStash + created, sources = [fromStash ? `${fromStash}件取自库存` : '', created && (fromGive || fromStash) ? `${created}件新建` : ''].filter(Boolean);
      if (total) parts.push(`${entry.name}${total > 1 ? '×' + total : ''}${gear ? '（装上）' : ''}${sources.length ? `（${sources.join('，')}）` : ''}`);
      else if (held) parts.push(`${entry.name}（已有${held}件，没有重复添加）`);
    }
    if (parts.length) context.notices.push(`交给${record.name}：${parts.join('、')}`);
  }
  // 装上的佩戴、充能道具立即投影进档案，开战时随单位生效。
  return prepareInventoryState(next) as NarrativeSave;
}
