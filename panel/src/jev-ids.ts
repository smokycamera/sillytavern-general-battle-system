import type { DecisionRequest, DecisionAnswer, Observation } from '../../vendor/jev-core/src/index.js';
import { mapNarrativeReferences, narrativeIds } from './narrative-ids.js';

type IdentityMap = ReturnType<typeof narrativeIds>;
export function publicObservation(observation: Observation, ids: IdentityMap): Observation {
  const result = mapNarrativeReferences(observation, ids.publicId);
  result.sessionId = 'b1';
  result.map = observation.map;
  result.goals = observation.goals;
  result.events = observation.events.map(event => ({ ...event, ...(event.unitIds ? { unitIds: event.unitIds.map(ids.publicId) } : {}) }));
  return result;
}
/** Option handles are request-local; model scores are restored before core validation/execution. */
export function publicDecision(request: DecisionRequest, ids: IdentityMap) {
  const optionIds = new Map(request.candidates.map((candidate, index) => ['o' + (index + 1), candidate.id]));
  const wire = mapNarrativeReferences(request, ids.publicId);
  wire.id = 'r1'; wire.sessionId = 'b1'; wire.observation = publicObservation(request.observation, ids);
  wire.commander.id = request.commander.id;
  wire.goal = request.goal;
  wire.candidates = wire.candidates.map((candidate, index) => ({ ...candidate, id: 'o' + (index + 1),
    ...(candidate.action ? { action: { ...candidate.action, id: 'o' + (index + 1) } } : {}) }));
  return { request: wire, restore(answer: DecisionAnswer): DecisionAnswer {
    if (!answer?.scores || typeof answer.scores !== 'object' || Array.isArray(answer.scores)) return answer;
    const scores: Record<string, number> = Object.create(null);
    for (const [id, score] of Object.entries(answer.scores)) {
      const realId = optionIds.get(id) ?? id;
      if (Object.hasOwn(scores, realId) && scores[realId] !== score) throw Error('模型返回冲突的候选评分');
      scores[realId] = score;
    }
    return { ...answer, scores };
  } };
}
