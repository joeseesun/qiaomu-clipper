// Full UI/helper catalogs. Other legacy message locales remain selectable as partial translations.
export const FULL_LOCALES = ['zh_CN', 'zh_TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt_BR'] as const;
export type UiLanguage = typeof FULL_LOCALES[number];

export function matchLocale(code: string | undefined, available: readonly string[] = FULL_LOCALES): string {
 const normalized = (code || '').replace(/-/g, '_').toLowerCase();
 if ((normalized === 'zh' || normalized.startsWith('zh_'))) {
  if (/(?:^|_)hans(?:_|$)/.test(normalized)) return 'zh_CN';
  return /(?:^|_)(tw|hk|mo|hant)(?:_|$)/.test(normalized) ? 'zh_TW' : 'zh_CN';
 }
 const exact = available.find(locale => locale.toLowerCase() === normalized);
 if (exact) return exact;
 const base = normalized.split('_')[0];
 return available.find(locale => locale.toLowerCase() === base) || (base === 'pt' && available.includes('pt_BR') ? 'pt_BR' : 'en');
}
