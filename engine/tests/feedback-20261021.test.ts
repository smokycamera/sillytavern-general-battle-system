import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, moraleProfile, commandAuraRange, grantTraitSource,
  V23_OVERFLOW_D20, V24_OVERFLOW_D20, V24_OVERFLOW_TW, type Combatant, type GenerateInput } from '../src/index.js';
import { playerTraitLevelDescription } from '../../panel/src/player-trait-description.js';

function unit(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 5, hpMax: 150,
    weaponClass: 'spear', weaponLevel: 5, armorTier: 1, traits: [], ...extra }, { seed: 'feedback' + id, noVariance: true }).unit;
  u.id = id; u.moraleLocked = true; return u;
}
function grid(units: Combatant[], rules = V24_OVERFLOW_D20) {
  const f = standardField(7, 9); f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
  f.spatialRulesVersion = 2; f.groundHeight = f.tiles.map(() => 0);
  const b = new SmallBattle({ combatants: units, rules, battlefield: f, seed: 'feedback' });
  b.start(); b.turnOrder = units.map(u => u.id); b.turnIndex = 0; return b;
}

describe('反馈：警戒和长矛对峙', () => {
  it('两名长矛在连续两轮没有交战后主动接战，读档后决策与结算一致', () => {
    const a = unit('0', 'ally'), e = unit('1', 'enemy'), b = grid([a, e]); a.pos = 38; e.pos = 17;
    for (let turn = 0; turn < 4; turn++) b.autoAction(b.active!.id);
    expect(b.log.some(entry => entry.resolution)).toBe(false);
    const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    for (const battle of [b, restored]) battle.autoAction(battle.active!.id);
    expect(b.log.some(entry => entry.resolution?.attackerId === a.id)).toBe(true);
    expect(restored.toSnapshot()).toEqual(b.toSnapshot());
  });
  it.each(['spear', 'rifle'])('面对持续警戒的%s有可承受的进攻机会时会接战', weaponClass => {
    const a = unit('0', 'ally'), e = unit('1', 'enemy', { weaponClass }), b = grid([a, e]); a.pos = 38; e.pos = 17;
    b.overwatch.add(e.id);
    for (let turn = 0; turn < 4 && !b.isOver(); turn++) {
      b.autoAction(a.id);
      if (b.active?.id === e.id) { if (!b.overwatchReason(e.id)) b.setOverwatch(e.id); b.endTurn(); }
    }
    expect(b.log.some(entry => entry.resolution?.attackerId === a.id)).toBe(true);
    expect(b.log.some(entry => entry.text.includes('警戒') && entry.resolution?.attackerId === e.id)).toBe(true);
  });
  it('低生命及明确固守不因对峙补偿强闯拒止', () => {
    for (const defensive of [false, true]) {
      const a = unit('0', 'ally'), e = unit('1', 'enemy'), b = grid([a, e]); a.pos = 38; e.pos = 17;
      if (defensive) b.allyTactic = 'defensive'; else a.hp = 5;
      for (let turn = 0; turn < 4; turn++) { b.autoAction(a.id); if (b.active?.id === e.id) { b.setOverwatch(e.id); b.endTurn(); } }
      expect(b.log.some(entry => entry.resolution?.attackerId === a.id)).toBe(false);
      if (defensive) expect(a.pos).toBe(38);
      expect(a.status).toBe('ready');
    }
  });
});

describe('反馈：统率范围按特质等级成长', () => {
  it('小战实际范围、最高外部来源、视线、失能和旧规则一致', () => {
    for (const rules of [V23_OVERFLOW_D20, V24_OVERFLOW_D20]) {
      const a = unit('a', 'ally'), c = unit('c', 'ally', { traits: ['commander'], traitLevels: { commander: 1 } }), e = unit('e', 'enemy');
      const actual = grid([a, c, e], rules); a.pos = 57; c.pos = 22; e.pos = 6;
      expect(moraleProfile(actual.observationContext(), a).command).toBe(0);
      grantTraitSource(c, { id: 'standard', name: '军旗', kind: 'blessing', traitIds: ['commander'], traitLevels: { commander: 5 }, duration: { kind: 'permanent' } });
      expect(commandAuraRange(c, 'small')).toBe(rules === V24_OVERFLOW_D20 ? 5 : 3);
      expect(moraleProfile(actual.observationContext(), a).command > 0).toBe(rules === V24_OVERFLOW_D20);
      if (rules === V24_OVERFLOW_D20) {
        expect(playerTraitLevelDescription('commander', 5, c.traitLevelModel, c.commandRangeModel)).toContain('5格');
        actual.battlefield!.tiles[36] = 'wall'; expect(moraleProfile(actual.observationContext(), a).command).toBe(0);
        actual.battlefield!.tiles[36] = 'open'; c.conditions.push({ id: 'stunned', dur: 1 });
        expect(moraleProfile(actual.observationContext(), a).command).toBe(0);
      }
      const restored = SmallBattle.fromSnapshot(structuredClone(actual.toSnapshot()));
      expect(commandAuraRange(restored.byId(c.id), 'small')).toBe(rules === V24_OVERFLOW_D20 ? 5 : 3);
    }
  });
  it('会战范围从1阵位成长为2、3阵位，恐惧仍按原范围', () => {
    const a = unit('a', 'ally', { scale: 'company', hpMax: 10 }), c = unit('c', 'ally', { scale: 'company', hpMax: 10, traits: ['commander'], traitLevels: { commander: 1 } }), e = unit('e', 'enemy', { scale: 'company', hpMax: 10, traits: ['fear'] });
    const b = new MassBattle({ combatants: [a, c, e], rules: V24_OVERFLOW_TW, seed: 'command-range' }); b.start();
    a.formationPosition = 'ally:中军:front'; c.formationPosition = 'ally:中军:reserve'; e.formationPosition = 'enemy:中军:reserve';
    expect(moraleProfile(b.observationContext(), a).command).toBe(0);
    c.traitLevels = { commander: 5 }; expect(commandAuraRange(c, 'mass')).toBe(2);
    expect(moraleProfile(b.observationContext(), a).command).toBeGreaterThan(0);
    c.traitLevels = { commander: 9 }; expect(commandAuraRange(c, 'mass')).toBe(3);
    expect(moraleProfile(b.observationContext(), a).fear).toBe(0);
    const restored = MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(moraleProfile(restored.observationContext(), restored.byId(a.id)).command).toBe(moraleProfile(b.observationContext(), a).command);
  });
});
