import { describe, it, expect } from 'vitest';
import { generatedLayeredField, generateUnit, normalizeBattlefieldPlan, gridDistance, validateField, type BattlefieldPlan, type BattlefieldSpec, type Combatant } from '../src/index.js';

function sceneUnit(id: string, side: 'ally' | 'enemy'): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', weaponLevel: 3, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}

const roster = (): Combatant[] => [sceneUnit('a1', 'ally'), sceneUnit('a2', 'ally'), sceneUnit('a3', 'ally'), sceneUnit('a4', 'ally'),
  sceneUnit('e1', 'enemy'), sceneUnit('e2', 'enemy'), sceneUnit('e3', 'enemy'), sceneUnit('e4', 'enemy')];
const bindings = { u1: 'a1', u2: 'a2', u3: 'a3', u4: 'a4', u5: 'e1', u6: 'e2', u7: 'e3', u8: 'e4' };
const evidence = { basis: 'explicit' as const, sources: ['m1.p1'] };
function siege(plan: Record<string, unknown>, seed = 'roles', attackingSide: 'ally' | 'enemy' = 'ally'): { field: BattlefieldSpec; at: (id: string) => number } {
  const field = generatedLayeredField(seed, 7, 13, ['siege'], { roster: roster(), attackingSide, plan: normalizeBattlefieldPlan({ scene: 'city_siege', ...plan }).plan, unitBindings: bindings });
  return { field, at: id => field.initialDeployment![id]!.pos };
}
const inCity = (field: BattlefieldSpec, p: number) => field.city!.inside.includes(p) || field.city!.frontline.includes(p);

describe('scene roles outrank how a force is described', () => {
  it.each([
    ['approaches_from', 'guards'], ['near', 'inside'], ['approaches_from', 'occupies'],
  ])('siege attackers that %s the city start outside while defenders that %s it hold the city', (attack, hold) => {
    const intent = { entities: [{ id: 'town', kind: 'city', anchor: 'north', ...evidence }],
      relations: [{ subject: 'enemy', relation: hold, object: 'town', ...evidence }, { subject: 'ally', relation: attack, object: 'town', ...evidence }] };
    for (const attacker of ['ally', 'enemy'] as const) {
      const defender = attacker === 'ally' ? 'enemy' : 'ally';
      const flipped = { ...intent, relations: intent.relations.map(r => ({ ...r, subject: r.subject === 'ally' ? attacker : defender })) };
      const { field, at } = siege({ intent: flipped }, 'roles-' + attack + attacker, attacker);
      for (const u of roster()) expect(inCity(field, at(u.id)), u.id).toBe(u.side === defender);
      expect(field.generation!.notes!.some(n => n.includes('攻方改在城外接近'))).toBe(true);
    }
  });
  it('keeps an explicit infiltrator inside the walls', () => {
    const intent = { entities: [{ id: 'town', kind: 'city', anchor: 'north', ...evidence }, { id: 'hall', kind: 'square', anchor: 'north', label: '府衙前', ...evidence }],
      relations: [{ subject: 'u1', relation: 'inside', object: 'hall', ...evidence }] };
    const { field, at } = siege({ intent });
    expect(inCity(field, at('a1'))).toBe(true);
    for (const id of ['a2', 'a3', 'a4']) expect(inCity(field, at(id))).toBe(false);
  });
  it('places compass deployments by role: attackers asked into the city keep a standoff, a manned wall lifts most guards', () => {
    const { field, at } = siege({ cityPosition: 'north', deployments: [{ subject: 'ally', at: ['north'] }, { subject: 'enemy', at: ['north'], post: 'wall' }] });
    const walls = field.city!.frontline;
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      expect(inCity(field, at(id))).toBe(false);
      expect(Math.min(...walls.map(q => gridDistance(field, at(id), q)))).toBeGreaterThan(1);
    }
    expect(Object.entries(field.initialDeployment!).filter(([id, d]) => id.startsWith('e') && d.elevation === 1)).toHaveLength(3);
    expect(field.generation!.notes!).toContain('我方改在城外正面开局');
  });
  it('lets a garrison sally out in front of its walls without touching the attackers', () => {
    const { field, at } = siege({ cityPosition: 'north', deployments: [{ subject: 'ally', at: ['south'] }, { subject: 'enemy', at: ['south'], post: 'outside' }] }, 'sortie');
    for (const u of roster()) expect(inCity(field, at(u.id))).toBe(false);
    for (const a of ['a1', 'a2', 'a3', 'a4']) for (const e of ['e1', 'e2', 'e3', 'e4']) expect(gridDistance(field, at(a), at(e))).toBeGreaterThan(1);
    expect(Object.values(field.initialDeployment!).every(d => d.elevation === undefined)).toBe(true);
  });
  it('keeps both sides out of a background town in an open-field battle', () => {
    const plan: BattlefieldPlan = { scene: 'field', intent: { schema: 'scene-intent-v1', entities: [{ id: 'town', kind: 'city', anchor: 'north', basis: 'inferred', sources: [] }], relations: [], constraints: [] } };
    const field = generatedLayeredField('outside-town', 7, 13, ['plains'], { roster: roster(), plan, unitBindings: bindings });
    expect(Object.values(field.initialDeployment!).every(d => !field.city!.inside.includes(d.pos))).toBe(true);
    expect(field.city!.defender).toBeUndefined();
  });
  it('rejects deployments for units outside the roster and malformed compass areas', () => {
    expect(() => generatedLayeredField('stranger', 7, 13, ['siege'], { roster: roster(), plan: { scene: 'city_siege', cityPosition: 'north', deployments: [{ subject: 'u99', at: ['south'] }] }, unitBindings: bindings })).toThrow('未参战单位');
    expect(() => normalizeBattlefieldPlan({ deployments: [{ subject: 'ally', at: ['up'] }] })).toThrow('九宫格');
    expect(() => normalizeBattlefieldPlan({ deployments: [{ subject: 'ally', at: ['south'] }, { subject: 'ally', at: ['north'] }] })).toThrow('只能写一项');
  });
  it('ruins a compound gate together with a destroyed target building', () => {
    const plan = { scene: 'building_siege', breaches: { count: 1 }, intent: { schema: 'scene-intent-v1', entities: [{ id: 'hall', kind: 'building', anchor: 'west', state: 'destroyed', basis: 'inferred', sources: [] }], relations: [], constraints: [] } };
    const field = generatedLayeredField('ruined-compound', 7, 13, ['siege'], { roster: roster(), attackingSide: 'enemy', plan: normalizeBattlefieldPlan(plan).plan, unitBindings: bindings });
    expect(() => validateField(field)).not.toThrow();
    expect(field.city!.gates.every(p => field.structures![p]!.gateState === 'destroyed')).toBe(true);
  });
});
