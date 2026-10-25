import { describe, expect, it } from 'vitest';
import { standardField } from '../../engine/src/small/spatial.js';
import { createStructure } from '../../engine/src/small/layers.js';
import { segments, segmentBand, segmentPath } from './terrain-geometry.js';
import { analyzeTerrain, gateAngle } from './terrain-scene.js';
import { buildPainted } from './terrain-painted.js';

describe('地图斜角连接', () => {
  const g = { w: 3, h: 3, n: 9 };
  const lines = (cells: number[]) => segments(g, cells, q => cells.includes(q), false);
  it('connects both diagonal slopes once, including neighbours outside the current draw group', () => {
    expect(lines([0, 4, 8])).toEqual([{ x0: 50, y0: 50, x1: 150, y1: 150 }, { x0: 150, y0: 150, x1: 250, y1: 250 }]);
    expect(lines([2, 4, 6])).toEqual([{ x0: 250, y0: 50, x1: 150, y1: 150 }, { x0: 150, y0: 150, x1: 50, y1: 250 }]);
    expect(segments(g, [4], q => [0, 4].includes(q), false)).toEqual(lines([0, 4]));
    expect(lines([2, 3])).toEqual([]);
  });
  it('keeps L corners and solid blocks free of diagonal shortcuts', () => {
    expect(lines([0, 1, 4])).toEqual([{ x0: 50, y0: 50, x1: 150, y1: 50 }, { x0: 150, y0: 50, x1: 150, y1: 150 }]);
    expect(lines([0, 1, 3, 4])).toHaveLength(4);
    expect(segments(g, [4], q => q === 4)).toEqual([{ x0: 128, y0: 150, x1: 172, y1: 150 }]);
  });
  it('keeps thickness and parallel detail lines aligned to a diagonal', () => {
    const s = { x0: 50, y0: 50, x1: 150, y1: 150 };
    expect(segmentBand(s, 20 * Math.SQRT2)).toBe('M60 40L160 140L140 160L40 60Z');
    expect(segmentPath(s, 10 * Math.SQRT2)).toBe('M40 60L140 160');
  });
  it('seals both terminal wall cells at the board edge, including diagonal ends, without filling broken cells', () => {
    const cells = [3,4,5], join = (q:number)=>cells.includes(q);
    expect(segments(g,cells,join,false,undefined,true)).toEqual(expect.arrayContaining([
      {x0:0,y0:150,x1:50,y1:150},{x0:300,y0:150,x1:250,y1:150},
    ]));
    expect(segments(g,[0,4,8],q=>[0,4,8].includes(q),false,undefined,true)).toEqual(expect.arrayContaining([
      {x0:0,y0:0,x1:50,y1:50},{x0:300,y0:300,x1:250,y1:250},
    ]));
    expect(segments(g,[4,5],q=>[4,5].includes(q),false,undefined,true).some(s=>s.x0===0)).toBe(false);
    const field=standardField();field.tiles.fill('open');field.layerVersion=1;field.structures=field.tiles.map(()=>null);
    for(let x=0;x<field.width;x++)field.structures[field.width*3+x]=createStructure('wall',3,{top:true});
    const before=JSON.stringify(field),markup=buildPainted(analyzeTerrain(field,'edge-wall'));
    expect(markup).toContain('M0 350L50 350');expect(markup).toContain('M700 350L650 350');
    expect(JSON.stringify(field)).toBe(before);
    field.structures[field.width*3]!.hp=0;
    expect(buildPainted(analyzeTerrain(field,'broken-edge'))).not.toContain('M0 350L50 350');
  });
  it('draws diagonal ramparts, rotates their gate, and leaves destroyed sections broken', () => {
    const field = standardField(); field.tiles.fill('open'); field.layerVersion = 1;
    field.structures = field.tiles.map(() => null);
    const cells = [8, 16, 24];
    for (const q of cells) field.structures[q] = createStructure(q === 16 ? 'gate' : 'wall', 3);
    const scene = analyzeTerrain(field, 'diagonal');
    expect(gateAngle(scene, 16)).toBe(45);
    const before = JSON.stringify(field), markup = buildPainted(scene);
    expect(markup).toContain('class="pt-walk" d="M150 150L250 250M250 250L350 350"');
    expect(markup).toContain('id="diagonal-gatecut"');
    expect(JSON.stringify(field)).toBe(before);
    field.structures[16]!.hp = 0;
    const broken = buildPainted(analyzeTerrain(field, 'broken'));
    expect(broken).not.toContain('L250 250'); expect(broken).not.toContain('gatecut');
    field.structures[16] = createStructure('gate', 3);
    field.structures[8] = null; field.structures[24] = null;
    field.structures[10] = createStructure('wall', 3); field.structures[22] = createStructure('wall', 3);
    expect(gateAngle(analyzeTerrain(field, 'opposite'), 16)).toBe(135);
    field.structures.fill(null);
    for (const q of [8, 9, 16]) field.structures[q] = createStructure('wall', 3);
    field.structures[9]!.hp = 0;
    expect(buildPainted(analyzeTerrain(field, 'broken-corner'))).not.toContain('M150 150L250 250');
  });
});
