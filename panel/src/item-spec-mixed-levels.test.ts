import { describe, expect, it } from 'vitest';
import { parseItemSpecification, parseSpawnItem, splitSpawnItems, itemSpecificationText } from './item-spec.js';
import { compileItem, itemSpecText } from '../../engine/src/items.js';

function specification(text: string) {
  const spec = parseItemSpecification(text);
  if (spec.kind !== 'item') throw new Error('Expected an item');
  return spec;
}

describe('mixed worn trait levels', () => {
  it.each([
    ['潜伏L3+林地专精L5+2防御', { stalk: 3, 'forest-lore': 5 }],
    ['潜伏L5+林地专精L3+2防御', { stalk: 5, 'forest-lore': 3 }],
  ] as const)('anchors numeric bonuses to the highest grade in %s', (text, levels) => {
    const spec = specification('精灵斗篷:' + text);
    expect(spec.form).toBe('worn'); expect(spec.power).toBe(5);
    expect(Object.fromEntries(spec.traits!.map(t => [t.id, t.level]))).toEqual(levels);
    const compiled = compileItem(spec, { id: 'cloak', seed: 'mixed-cloak', name: '精灵斗篷' });
    if (compiled.kind !== 'item') throw new Error('Expected compiled item');
    expect(compiled.value.recipe.power).toBe(5);
    expect(compiled.value.passive!.actualEffects!.values.defense).toBe(.5);
    expect(specification(itemSpecText(compiled.value.recipe))).toEqual(spec);
    const restored = JSON.parse(JSON.stringify(compiled.value));
    expect(restored.passive.actualEffects.values.defense).toBe(.5);
    expect(specification(itemSpecificationText(spec))).toEqual(spec);
  });

  it('keeps shared-grade notation and merges repeated traits using their highest grade', () => {
    const shared = specification('潜伏、林地专精L5+2防御');
    expect(shared.traits!.map(t => t.level)).toEqual([5,5]);
    const repeated = specification('潜伏L3+潜伏L5-2防御');
    expect(repeated.traits).toEqual([{ id: 'stalk', level: 5 }]);
    expect(repeated.power).toBe(5); expect(repeated.bonuses).toEqual({ defense: -2 });
  });

  it('parses the composite spec through the spawn inventory path without splitting the item', () => {
    const text = '精灵斗篷:潜伏L3+林地专精L5+2防御×2';
    expect(splitSpawnItems(text + ',药水:buff治疗L3')).toHaveLength(2);
    const item = parseSpawnItem(text);
    expect(item.qty).toBe(2); expect(item.spec!.power).toBe(5);
    expect(item.spec!.traits).toEqual([{ id: 'stalk', level: 3 }, { id: 'forest-lore', level: 5 }]);
  });

  it('rejects invalid grades and does not treat a skill-effect grade as numeric bonus points', () => {
    expect(() => specification('潜伏L3+林地专精L11+2防御')).toThrow();
    expect(() => specification('潜伏L3+林地专精L5+防御L2')).toThrow();
  });
});
