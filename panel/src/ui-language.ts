import englishMessages from './ui-messages.en.json';
import { formatDisplayText, type DisplayText } from '../../engine/src/display-text.js';

export type UiLanguage = 'zh-CN' | 'en';

let language: UiLanguage = 'zh-CN';
const english: Readonly<Record<string, string>> = englishMessages;

export function uiLanguage(): UiLanguage {
  return language;
}

export function setUiLanguage(value: UiLanguage): void {
  language = value;
  document.documentElement.lang = value;
}

/** Translate interface copy only. Interpolation values keep their original text. */
export const ui: DisplayText = (source, values) => {
  const message = language === 'en' && Object.hasOwn(english, source) ? english[source]! : source;
  return formatDisplayText(message, values);
};
