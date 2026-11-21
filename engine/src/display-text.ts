export type DisplayText = (source: string, values?: Record<string, string | number>) => string;

export const formatDisplayText: DisplayText = (source, values) => values
  ? source.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token)
  : source;
