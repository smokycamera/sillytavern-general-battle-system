import englishMessages from './ui-messages.en.json';
import { formatDisplayText, type DisplayText } from '../../engine/src/display-text.js';

export type UiLanguage = 'zh-CN' | 'en';

let language: UiLanguage = 'zh-CN';
const english: Readonly<Record<string, string>> = englishMessages;
const displayText: Readonly<Record<UiLanguage, DisplayText>> = {
  'zh-CN': formatDisplayText,
  en: (source, values) => formatDisplayText(Object.hasOwn(english, source) ? english[source]! : source, values),
};

export function uiLanguage(): UiLanguage {
  return language;
}

export function setUiLanguage(value: UiLanguage): void {
  language = value;
  document.documentElement.lang = value;
}

export const displayTextFor = (locale: UiLanguage): DisplayText => displayText[locale];
/** Interpolation values keep their original text. */
export const ui: DisplayText = (source, values) => displayText[language](source, values);
