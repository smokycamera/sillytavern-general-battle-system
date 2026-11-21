import type { HostWindow } from '../../host/src/sillytavern.js';
import type { UiLanguage } from '../../panel/src/ui-language.js';
import { normalizeEmbeddedWorldbookSettings, type EmbeddedWorldbookSettings } from './embedded-worldbook.js';

export interface DisplayPreferences {
  disabledChats?: string[];
  theme?: 'dark' | 'light';
  language?: UiLanguage;
  entryPosition?: { left: number; top: number };
  geometry?: { left: number; top: number; width: number; height: number };
  worldbook?: EmbeddedWorldbookSettings;
}

export function preferences(host: HostWindow): { read(): DisplayPreferences; write(value: DisplayPreferences): void } {
  return {
    read() {
      const context = host.SillyTavern?.getContext();
      const raw = context?.extensionSettings?.tavernBattle;
      const value = raw && typeof raw === 'object' ? raw as DisplayPreferences : {};
      const geometry = value.geometry; const entryPosition = value.entryPosition;
      // Both hosts publish their selected locale on the root element and reload when it changes.
      const hostLocale = (host as unknown as Window).document?.documentElement.lang.trim();
      const language = value.language === 'en' || value.language === 'zh-CN'
        ? value.language
        : hostLocale && !/^zh(?:-|$)/i.test(hostLocale) ? 'en' : 'zh-CN';
      const rawWorldbook = value.worldbook && typeof value.worldbook === 'object' ? value.worldbook : undefined;
      const worldbook = rawWorldbook ? normalizeEmbeddedWorldbookSettings(rawWorldbook) : undefined;
      if (worldbook && rawWorldbook?.builtinRevision !== worldbook.builtinRevision) {
        context!.extensionSettings!.tavernBattle = { ...value, worldbook };
        context!.saveSettingsDebounced?.();
      }
      return {
        ...(Array.isArray(value.disabledChats) ? {disabledChats:value.disabledChats.filter(key => typeof key === 'string')} : {}),
        ...(entryPosition && Number.isFinite(entryPosition.left) && Number.isFinite(entryPosition.top) ? { entryPosition: { ...entryPosition } } : {}),
        theme: value.theme === 'light' ? 'light' : 'dark',
        language,
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
