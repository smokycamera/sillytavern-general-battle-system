import { expect, it } from 'vitest';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { traceLocations, traceOverlay } from './battle-presentation.js';

it('aims an area skill at its chosen target, while keeping collateral cells in the highlight', () => {
  const { b } = tacticalFixture(), actor = b.byId('a');
  const fire = actor.abilities.find(ability => ability.definitionId === 'bp-firestorm')!;
  expect(b.useAbility('a', fire.id, 'b').ok).toBe(true);
  const event = [...b.log].reverse().find(entry => entry.kind === 'ability')!;
  expect(event.locations).toMatchObject({a:45,b:31,d:24});
  const trace = traceLocations(b)!;
  expect(trace).toMatchObject({from:45,to:31});
  expect(trace.cells).toEqual(expect.arrayContaining([45,31,24]));
  expect(traceOverlay(b)).toContain('x2="350" y2="450"');
});

it('orders numeric unit IDs by the event participants and keeps historical positions after units move', () => {
  const { b } = tacticalFixture();
  b.log.push({round:b.round,kind:'ability',text:'治疗',participants:['10','2'],locations:{'10':45,'2':44},observedBy:['ally']});
  expect(Object.values(b.log.at(-1)!.locations!)).toEqual([44,45]);
  expect(traceLocations(b)).toMatchObject({from:45,to:44});
  b.byId('a').pos = 70; b.byId('c').pos = 71;
  expect(traceLocations(b)).toMatchObject({from:45,to:44});
});

it('uses the recorded move endpoints and does not aim a self skill at its collateral target', () => {
  const { b } = tacticalFixture();
  b.log.push({round:b.round,kind:'move',text:'A1队移动',participants:['a'],locations:{a:46},move:{from:45,to:46},observedBy:['ally']});
  expect(traceLocations(b)).toMatchObject({from:45,to:46});
  b.log.push({round:b.round,kind:'ability',text:'自身周围生效',participants:['a','a','b'],locations:{a:45,b:31},observedBy:['ally']});
  expect(traceLocations(b)).toMatchObject({from:45,to:45});
  expect(traceOverlay(b)).toBe('');
});
