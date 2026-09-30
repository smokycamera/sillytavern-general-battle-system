import type { SmallBattle } from './small/battle.js';
import { cellLabel } from './small/spatial.js';

/** One result description for the event log, archive and all narrative report formats. */
export function smallBattleResult(battle: SmallBattle): string | undefined {
  if (!battle.isOver()) return;
  const recorded = battle.log.filter(entry => entry.kind === 'battle-end').at(-1)?.text;
  if (recorded && !/^任务结束：(ally|enemy|draw)$/.test(recorded)) return recorded;
  const winner = battle.winner();
  if (!winner || winner === 'draw') return '战斗结束：双方停战或僵持';
  const who = winner === 'ally' ? '我方' : '敌方', goal = battle.battlefield?.objective;
  if (goal?.kind === 'control' && battle.objectiveWinner === winner) {
    const progress = battle.controlRounds[winner];
    if (progress >= goal.rounds) return `${who}${goal.attackingSide ? '作为攻方' : ''}占旗获胜：控制${goal.cells?.length ? '旗区' : '旗点'}${cellLabel(battle.battlefield!, goal.cell)}满${goal.rounds}个完整回合（${progress}/${goal.rounds}）；本场因占领取胜结束`;
    if (goal.attackingSide && winner !== goal.attackingSide && battle.round >= goal.limit) return `${who}作为守方守城成功：攻方未在第${goal.limit}轮期限内完成${goal.rounds}个完整回合的占领，守方获胜`;
  }
  return `${who}战斗胜利`;
}
