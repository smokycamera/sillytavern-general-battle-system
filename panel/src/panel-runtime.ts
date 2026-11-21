import { NarrativeController } from './narrative-controller.js';
import { createAdapter, type SaveReceipt, type TavernAdapter, type DeliveryReceipt } from './tavern.js';
import type { PanelController } from './controller-port.js';
import { createWorldbookSource, type WorldbookSource } from '../../host/src/worldbooks.js';
import type { UiLanguage } from './ui-language.js';
import type { NarrativeSave } from './narrative-state.js';
import type { InventoryItem } from './inventory-state.js';
import type { LlmEncounterContext } from './llm-context.js';
import type { OrderDrafts } from './formation-orders.js';

const LANGUAGE_KEY = 'tavern-battle:language';
export interface BattleTurnSave {
  battle: NonNullable<NarrativeSave['battle']>;
  encounterContext?: LlmEncounterContext;
  orderDraft?: OrderDrafts;
  orderMemory?: OrderDrafts;
}

export interface CustomWorldbookEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  keys: string[];
  depth: number;
  role: number;
  order: number;
}
export interface WorldbookEditorItem {
  id: string;
  title: string;
  content: string;
  defaultContent: string;
  depth: number;
  role: number;
  order: number;
  custom?: CustomWorldbookEntry;
}
export interface WorldbookEditorState { enabled: boolean; items: WorldbookEditorItem[]; injectionMode?: 'native' | 'depth' }
export interface WorldbookEditorUpdate {
  enabled?: boolean;
  entry?: { id: string; content?: string };
  create?: boolean;
  custom?: { id: string; patch?: Partial<Omit<CustomWorldbookEntry, 'id'>>; delete?: boolean };
}

export interface PanelRuntime {
  worldbooks?: WorldbookSource;
  recentNarrative?: () => import('../../vendor/jev-core/src/types.js').NarrativeMessage[];
  adapter: TavernAdapter;
  controller: PanelController;
  resident: boolean;
  native: boolean;
  retrySave?: () => Promise<SaveReceipt>;
  canWrite?: () => boolean;
  writeBlockReason?: () => string | undefined;
  /** A save is still running (long chats save slowly); not a failure to act on. */
  saving?: () => boolean;
  reloadArchive?: () => Promise<void>;
  retryGeneration?: (deliveryId: string) => Promise<DeliveryReceipt>;
  isEnabled?: () => boolean;
  setEnabled?: (active: boolean) => Promise<void>;
  getTheme?: () => 'dark' | 'light';
  setTheme?: (theme: 'dark' | 'light') => void;
  getLanguage?: () => UiLanguage;
  setLanguage?: (language: UiLanguage) => void;
  persistBattleTurn?: (turn: BattleTurnSave, revision: number) => Promise<{ receipt: SaveReceipt; revision: number; inventory?: InventoryItem[] }>;
  getWorldbookSettings?: () => WorldbookEditorState;
  setWorldbookSettings?: (update: WorldbookEditorUpdate) => WorldbookEditorState;
}
export function createPanelRuntime(): PanelRuntime {
  const adapter = createAdapter();
  const resident = (window.parent as unknown as { __tavernBattleController?: NarrativeController }).__tavernBattleController;
  const worldbooks = createWorldbookSource(() => (window.parent as unknown as import('../../host/src/sillytavern.js').HostWindow).SillyTavern?.getContext() ?? {});
  window.addEventListener('pagehide', event => { if (!event.persisted) worldbooks.dispose?.(); });
  return { adapter, controller: resident ?? new NarrativeController(adapter), resident: !!resident, native: false,
    worldbooks,
    getLanguage: () => {
      try { return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh-CN'; }
      catch { return 'zh-CN'; }
    },
    setLanguage: language => {
      try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* The current panel can still switch languages. */ }
    },
    recentNarrative: () => { const text=adapter.recentPromptText?.()??'';return text?[{id:'legacy-recent',role:'assistant',text,completed:true}]:[]; },
  };
}
