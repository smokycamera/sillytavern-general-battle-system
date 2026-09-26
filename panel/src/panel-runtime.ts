import { NarrativeController } from './narrative-controller.js';
import { createAdapter, type SaveReceipt, type TavernAdapter, type DeliveryReceipt } from './tavern.js';
import type { PanelController } from './controller-port.js';

export interface PanelRuntime {
  recentNarrative?: () => import('../../vendor/jev-core/src/types.js').NarrativeMessage[];
  adapter: TavernAdapter;
  controller: PanelController;
  resident: boolean;
  native: boolean;
  retrySave?: () => Promise<SaveReceipt>;
  canWrite?: () => boolean;
  writeBlockReason?: () => string | undefined;
  reloadArchive?: () => Promise<void>;
  retryGeneration?: (deliveryId: string) => Promise<DeliveryReceipt>;
  getTheme?: () => 'dark' | 'light';
  setTheme?: (theme: 'dark' | 'light') => void;
}
export function createPanelRuntime(): PanelRuntime {
  const adapter = createAdapter();
  const resident = (window.parent as unknown as { __tavernBattleController?: NarrativeController }).__tavernBattleController;
  return { adapter, controller: resident ?? new NarrativeController(adapter), resident: !!resident, native: false,
    recentNarrative: () => { const text=adapter.recentPromptText?.()??'';return text?[{id:'legacy-recent',role:'assistant',text,completed:true}]:[]; },
  };
}
