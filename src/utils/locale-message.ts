export type LocaleMessage = { message: string; placeholders?: Record<string, { content: string }> };
// Expand named placeholders before substituting numbered values, and replace every occurrence.
export function formatLocaleMessage(entry: LocaleMessage, substitutions?: string | string[]): string {
 const named = entry.message.replace(/\$([a-z_][a-z0-9_]*)\$/gi, (token, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? entry.placeholders?.[name]?.content ?? token);
 const values = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
 return named.replace(/\$(\d+)\b/g, (token, index) => values[Number(index) - 1] ?? token);
}
export function localeMessage(locale: string, key: string, substitutions?: string | string[]): string | undefined {
 if (!key) return undefined;
 const english = require('../_locales/en/messages.json') as Record<string, LocaleMessage>;
 let messages: Record<string, LocaleMessage> = {};
 try { messages = require(`../_locales/${locale}/messages.json`); } catch { /* English fallback */ }
 const entry = messages[key] || english[key];
 return entry ? formatLocaleMessage(entry, substitutions) : undefined;
}
