import { describe, expect, it } from 'vitest';
import { generatedLayeredField } from '../src/small/layered-generator.js';
import { INTERIOR_PATTERNS } from '../src/small/interior-plan.js';
import { groundBlocked } from '../src/small/layers.js';
import { findGridPath, validateField } from '../src/small/spatial.js';
import { geometrySignature } from '../src/small/map-metrics.js';
import { generateUnit, prepareGridDeployment, SmallBattle, V11_OVERFLOW_D20 } from '../src/index.js';
import { compileLayout, type LayoutContext } from '../../panel/src/llm-layout.js';

describe('indoor rooms and circulation', () => {
  it.each(INTERIOR_PATTERNS)('%s keeps every room and deployment floor connected with open doors', pattern => {
    for (const size of ['compact','standard','large'] as const) for (const seed of ['rooms-a','rooms-b','rooms-c']) {
      const f = generatedLayeredField(seed,7,13,['indoor'],{plan:{scene:'interior',size,interior:{use:'residence',pattern}}});
      validateField(f);
      const rooms = f.generation!.interior!.rooms;
      expect(rooms.length).toBeGreaterThan(1);
      expect(new Set(rooms.flatMap(r=>r.cells)).size).toBe(rooms.reduce((n,r)=>n+r.cells.length,0));
      for (const p of f.tiles.flatMap((_,p)=>!groundBlocked(f,p)?[p]:[])) {
        expect(findGridPath(f,p,f.objective.cell,n=>!groundBlocked(f,n)),`${pattern} ${size} ${seed} ${p}`).toBeDefined();
      }
    }
  });
  it('binds a named room to an actual floor area and permits a named furnishing inside it', () => {
    const ctx: LayoutContext={scene:'interior',size:'standard',attacker:'ally',objectiveMode:'annihilation',units:[],map:[7,13]};
    const plan=compileLayout({interior:{use:'residence',pattern:'hall'},places:[{type:'room',name:'北书房',at:'N'},{type:'cover',name:'北屏风',at:'N'}]},ctx).plan;
    const f=generatedLayeredField('named-rooms',7,13,['indoor'],{plan});
    const room=f.scene!.regions.find(r=>r.label==='北书房')!, screen=f.scene!.regions.find(r=>r.label==='北屏风')!;
    expect(room.cells.length).toBeGreaterThan(1);
    expect(screen.cells.every(p=>f.structures![p]?.kind==='cover')).toBe(true);
    expect(room.cells.some(p=>screen.cells.includes(p))).toBe(true);
  });
  it('keeps a northern main hall large and distinct from the northeast side room', () => {
    const ctx: LayoutContext={scene:'interior',size:'compact',attacker:'ally',objectiveMode:'annihilation',units:[],map:[5,7]};
    const plan=compileLayout({interior:{use:'temple',pattern:'hall'},places:[{type:'room',name:'正殿',at:'N'},{type:'cover',name:'石柱',at:'N'},{type:'room',name:'祭司侧室',at:'NE'},{type:'room',name:'前殿',at:'S'}]},ctx).plan;
    const f=generatedLayeredField('live-temple-regression',7,13,['indoor'],{plan});
    const hall=f.scene!.regions.find(r=>r.label==='正殿')!,side=f.scene!.regions.find(r=>r.label==='祭司侧室')!;
    expect(hall.cells.length).toBeGreaterThan(side.cells.length);
    expect(hall.cells.reduce((sum,p)=>sum+Math.floor(p/f.width),0)/hall.cells.length).toBeLessThan((f.height-1)/2);
  });
  it('honors independently closed, open and destroyed planned doors without removing adjacent partitions', () => {
    const f=generatedLayeredField('doors',7,13,['indoor'],{plan:{scene:'interior',size:'standard',interior:{pattern:'ring'},gatePlan:[
      {id:'entry',sector:'north',state:'closed'},{id:'exit',sector:'south',state:'open'},{id:'broken',sector:'east',state:'destroyed'},
    ]}});
    expect(f.structures!.filter(s=>s?.kind==='gate').map(s=>[s!.entityId,s!.gateState])).toEqual(expect.arrayContaining([['entry','closed'],['exit','open'],['broken','destroyed']]));
    expect(f.structures!.find(s=>s?.entityId==='broken')!.hp).toBe(0);
  });
  it('freezes actual rooms, furniture and unit deployment through save/restore', () => {
    const roster=(['ally','enemy'] as const).flatMap(side=>Array.from({length:4},(_,i)=>{
      const u=generateUnit({name:side+i,side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:'sword',weaponLevel:3,traits:[]},{seed:side+i,noVariance:true}).unit;
      u.id=side+i;return u;
    }));
    const f=generatedLayeredField('save-rooms',7,13,['indoor'],{roster,plan:{scene:'interior',size:'standard',interior:{use:'office',pattern:'cross'}}});
    expect(prepareGridDeployment(f,roster,'save-rooms')).toHaveLength(roster.length);
    const b=new SmallBattle({battlefield:f,combatants:roster,rules:V11_OVERFLOW_D20,seed:'save-rooms'});b.start();
    expect(SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())).toSnapshot()).toEqual(b.toSnapshot());
  });
  it('adds different room organizations locally and reproduces the same seed exactly', () => {
    const patterns=new Set<string>(), skeletons=new Set<string>();
    for(let i=0;i<80;i++) {
      const f=generatedLayeredField('local-indoor-'+i,9,15,['indoor'],{scene:'interior'});
      patterns.add(f.generation!.interior!.pattern);
      skeletons.add(JSON.stringify(f.structures!.map(s=>s?.kind==='building'||s?.kind==='gate'?s.kind:null)));
      if(i<3) expect(geometrySignature(generatedLayeredField('local-indoor-'+i,9,15,['indoor'],{scene:'interior'}))).toBe(geometrySignature(f));
    }
    expect(patterns.size).toBe(8);expect(skeletons.size).toBeGreaterThan(40);
  });
});
