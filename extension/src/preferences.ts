import type { HostWindow } from '../../host/src/sillytavern.js';
import { normalizeEmbeddedWorldbookSettings, type EmbeddedWorldbookSettings } from './embedded-worldbook.js';

export interface DisplayPreferences {
  theme?: 'dark' | 'light';
  entryPosition?: { left: number; top: number };
  geometry?: { left: number; top: number; width: number; height: number };
  worldbook?: EmbeddedWorldbookSettings;
}

export function preferences(host: HostWindow): { read(): DisplayPreferences; write(value: DisplayPreferences): void } {
  return {
    read() {
      const raw = host.SillyTavern?.getContext().extensionSettings?.tavernBattle;
      if (!raw || typeof raw !== 'object') return {};
      const value = raw as DisplayPreferences; const geometry = value.geometry; const entryPosition = value.entryPosition;
      const rawWorldbook = value.worldbook && typeof value.worldbook === 'object' ? value.worldbook : undefined;
      const worldbook = rawWorldbook ? normalizeEmbeddedWorldbookSettings(rawWorldbook) : undefined;
      return {
        ...(entryPosition && Number.isFinite(entryPosition.left) && Number.isFinite(entryPosition.top) ? { entryPosition: { ...entryPosition } } : {}),
        theme: value.theme === 'light' ? 'light' : 'dark',
        ...(geometry && Object.values(geometry).every(Number.isFinite) && geometry.width >= 320 && geometry.height >= 260 ? { geometry: { ...geometry } } : {}),
        ...(worldbook ? { worldbook } : {}),
      };
    },
    write(value) {
      const context = host.SillyTavern?.getContext(); if (!context?.extensionSettings) return;
      const old = context.extensionSettings.tavernBattle;
      context.extensionSettings.tavernBattle = { ...(old && typeof old === 'object' ? old : {}), ...value };
      context.saveSettingsDebounced?.();
      if(value.theme) (host as unknown as Window).document?.getElementById('tavern-battle-native-panel')?.setAttribute('data-theme', value.theme);
    },
  };
}
