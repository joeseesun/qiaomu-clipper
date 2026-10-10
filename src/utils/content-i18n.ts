import { matchLocale } from './locale';
import { localeMessage } from './locale-message';
import { setUiLanguage, t } from './ui-text';

type LocaleApi = { i18n?: { getUILanguage?(): string }; storage: { local?: { get(keys: string): Promise<Record<string, unknown>> } } };
export async function createContentText(api: LocaleApi, browserLanguage = api.i18n?.getUILanguage?.() || navigator.language): Promise<(key: string, zh: string, en: string) => string> {
 let saved: unknown;
 try { saved = (await api.storage.local?.get('language'))?.language; } catch { /* Extension updated or storage unavailable. */ }
 const locale = matchLocale(typeof saved === 'string' && saved ? saved : browserLanguage);
 setUiLanguage(locale);
 return (key, zh, en) => localeMessage(locale, key) ?? (locale === 'zh_CN' ? zh : locale === 'zh_TW' ? t(zh) : en);
}
