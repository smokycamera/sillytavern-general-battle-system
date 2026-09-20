import { NarrativeController } from './narrative-controller.js';
import { createAdapter } from './tavern.js';
const host = window.parent !== window ? window.parent : window;
const shared = host as unknown as { __tavernBattleController?: NarrativeController };
shared.__tavernBattleController?.dispose();
const controller = new NarrativeController(createAdapter());
shared.__tavernBattleController = controller;
window.addEventListener('pagehide', () => {
  if (shared.__tavernBattleController === controller) {
    controller.dispose(); delete shared.__tavernBattleController;
  }
});
