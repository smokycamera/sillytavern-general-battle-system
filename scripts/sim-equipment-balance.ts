import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, traitRegistry } from '../engine/src/index.js';
import { compileArmor } from '../engine/src/gen/equipment.js';
const registry=traitRegistry();
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=')??fallback;
const seeds=Number(arg('seeds','20')),roundLimit=Number(arg('rounds','30')),requestedMode=arg('mode','both');
const output=arg('output','engine/sim/out/balance-matches.json');
const morale=arg('morale','100');
if(!Number.isInteger(seeds)||seeds<1||!Number.isInteger(roundLimit)||roundLimit<1||!['both','small','mass'].includes(requestedMode))throw Error('Invalid simulation options');
const scenarios=[
  {name:'剑 vs 钝器 / 无甲',a:'sword',b:'blunt',armor:0},
  {name:'剑 vs 钝器 / 重甲',a:'sword',b:'blunt',armor:3},
  {name:'剑 vs 斧 / 无甲',a:'sword',b:'axe',armor:0},
  {name:'剑 vs 斧 / 重甲',a:'sword',b:'axe',armor:3},
  {name:'剑 vs 长柄 / 中甲',a:'sword',b:'spear',armor:2},
  {name:'轻型投射 vs 投掷 / 中甲',a:'light-ranged',b:'throwing',armor:2},
  {name:'步枪 vs 单发重步枪 / 中甲',a:'rifle',b:'heavy-rifle',armor:2},
  {name:'步枪 vs 单发重步枪 / 超重甲',a:'rifle',b:'heavy-rifle',armor:4},
  {name:'步枪 vs 能量 / 动能特化重甲',a:'rifle',b:'energy',armor:3,profile:'kinetic'},
  {name:'步枪 vs 能量 / 热能特化重甲',a:'rifle',b:'energy',armor:3,profile:'thermal'},
] as const;
const rows=[];
for(const mode of (requestedMode==='both'?['small','mass']:[requestedMode]))for(const scenario of scenarios){
  let wins=0,losses=0,draws=0,rounds=0,timeouts=0;
  for(let seed=0;seed<seeds;seed++)for(const swap of [false,true]){
    const make=(side:'ally'|'enemy',weapon:string)=>{
      const u=generateUnit({name:side,side,scale:mode==='small'?'hero':'company',rulesVersion:'v2',level:5,
        hpMax:mode==='small'?42:100,weaponClass:weapon,weaponLevel:3,armorTier:scenario.armor,armorLevel:3,traits:[]},
        {registry,seed:'balanced-gear',noVariance:true}).unit;
      u.id=side;u.abilities=[];u.preparedAbilityIds=[];if(morale!=='default')u.morale=u.base.moraleMax=Number(morale);
      if('profile' in scenario)u.armor=compileArmor({tier:scenario.armor,power:3,profile:scenario.profile},{id:side+'-armor',seed:'armor',noVariance:true});
      u.tags.push('zone:中军','rank:front');return u;
    };
    const a=make(swap?'enemy':'ally',scenario.a),b=make(swap?'ally':'enemy',scenario.b),units=swap?[b,a]:[a,b];
    const field=standardField();field.tiles.fill('open');
    const battle=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:'audit:'+seed,traitRegistry:registry})
      :new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:'audit:'+seed,traitRegistry:registry});
    battle.start();
    if(battle instanceof SmallBattle){units[0]!.pos=38;units[1]!.pos=24;}
    for(let step=0;step<roundLimit*4&&!battle.isOver()&&battle.round<=roundLimit;step++){
      if(battle instanceof SmallBattle){if(battle.active)battle.autoAction(battle.active.id);else break;}
      else {battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();}
    }
    const winner=battle.winner();wins+=Number(winner===a.side);losses+=Number(winner===b.side);draws+=Number(winner==='draw');timeouts+=Number(!battle.isOver());rounds+=battle.round;
  }
  const result={mode,scenario:scenario.name,games:seeds*2,aWins:wins,bWins:losses,draws,timeouts,meanRounds:rounds/(seeds*2)};rows.push(result);console.log(JSON.stringify(result));
}
mkdirSync('engine/sim/out',{recursive:true});
writeFileSync(output,JSON.stringify({method:`${rows.length*seeds*2} seeded real AI battles; ${seeds} seeds × side swap × 10 matchups × ${requestedMode}. Training5, equipment3, equal armor, hero42hp/company100 members, open terrain, close 2-cell start (small)/opposing frontline (mass), no skills, morale=${morale}, external cutoff ${roundLimit} rounds (mass engine also enforces its default 40-round limit). Default local AI, not JEV. These are scenario-specific samples, not universal win rates.`,rows},null,2)+'\n');
