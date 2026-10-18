import { computeBattleStep, type BattleStepRequest } from './battle-step.js';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; request: BattleStepRequest }>) => void;
  postMessage: (value: unknown) => void;
};
worker.onmessage = ({ data: { id, request } }) => {
  try { worker.postMessage({ id, result: computeBattleStep(request) }); }
  catch (error) { worker.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
