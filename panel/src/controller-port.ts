import type { NarrativeController } from './narrative-controller.js';

type Mutations = 'persistPanel' | 'setPromptSettings' | 'setStorySync' | 'deleteBattleReport' | 'restoreBattleReport' | 'restartBattleReport'
  | 'revokeBlessing' | 'inventoryAction' | 'commitInventoryPreview' | 'deleteUnit' | 'restoreDeployment' | 'approve' | 'correctProposal'
  | 'reject' | 'deleteRecords' | 'acceptMigration' | 'restoreMigrationBackup';
/** Read methods remain synchronous snapshots; every mutation may await persistence. */
export type PanelController = Omit<NarrativeController, Mutations> & {
  [K in Mutations]: NarrativeController[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never
};
