// Which subtitle language a video's bar shows, and which the viewer asked for. Shared by the YouTube and Bilibili bars.
export interface TrackInfo { id: string; label: string; language: string; languageCode?: string; auto: boolean; original?: boolean; translated?: boolean }
export interface LanguageOption { id: string; label: string }

// "zh-CN" and "ai-zh" are both Chinese; "en-US" is English.
export const languageBase = (code: unknown): string => String(code ?? '').toLowerCase().replace(/_/g, '-').replace(/^ai-/, '').split('-')[0];

// Explicit original-audio metadata wins; a single automatic language is a fallback hint.
// Multiple automatic languages may be dubs, so their list order is not evidence of the original.
export function chooseTrack<T extends TrackInfo>(tracks: T[], preferred?: string): T | undefined {
	if (!tracks.length) return undefined;
	const best = (list: T[]) => list.find(track => !track.auto) ?? list[0];
	const inLanguage = (language: string) => best(tracks.filter(track => languageBase(track.language) === languageBase(language)));
	if (preferred) { const wanted = inLanguage(preferred); if (wanted) return wanted; }
	const original = tracks.filter(track => track.original);
	if (original.length) return best(original);
	const automaticLanguages = [...new Set(tracks.filter(track => track.auto && !track.translated).map(track => track.language))];
	if (automaticLanguages.length === 1) return inLanguage(automaticLanguages[0]);
	return inLanguage('zh') ?? inLanguage('en') ?? best(tracks);
}
export function optionsOf(tracks: TrackInfo[], locale?: string, autoLabel = 'auto-generated'): LanguageOption[] {
 let names: Intl.DisplayNames | undefined;
 try { if (locale) names = new Intl.DisplayNames([locale.replace('_', '-')], { type: 'language', fallback: 'none' }); } catch { /* Keep the source label if the browser cannot name the language. */ }
 return tracks.map(({ id, label, language, languageCode, auto }) => {
  try {
   const name = names?.of(languageCode || language);
   if (name) label = name + (auto ? ` (${autoLabel})` : '') + (/~(\d+)$/.test(id) ? ` · ${id.match(/~(\d+)$/)![1]}` : '');
  } catch { /* Unknown source language. */ }
  return { id, label };
 });
}

// The choice is remembered per video (never as a global rule: a viewer who reads one video in English did not ask for
// every video in English). Kept small: the most recent 60 videos.
const STORE = 'qiaomuBarLanguages', LIMIT = 60;
const read = (): Record<string, string> => { try { const value = JSON.parse(localStorage.getItem(STORE) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
export const savedLanguage = (videoKey: string): string | undefined => { const value = read()[videoKey]; return typeof value === 'string' && /^[a-z]{2,8}$/.test(value) ? value : undefined; };
export function saveLanguage(videoKey: string, language: string): void {
	if (!/^[a-z]{2,8}$/.test(language)) return;
	try { const all = read(); delete all[videoKey]; all[videoKey] = language; const keys = Object.keys(all); for (const old of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete all[old]; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage unavailable: the choice just applies to this page */ }
}
// A transcript is cached per language the viewer chose; the default (spoken) language uses the plain key.
export const cacheKeyFor = (videoKey: string, language?: string): string => (language ? `${videoKey}#${language}` : videoKey);
