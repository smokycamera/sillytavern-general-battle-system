import englishMessages from './ui-messages.en.json';

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
export function ui(source: string, values?: Record<string, string | number>): string {
  const message = language === 'en' && Object.hasOwn(english, source) ? english[source]! : source;
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token);
}
