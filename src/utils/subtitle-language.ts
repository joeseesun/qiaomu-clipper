// Which subtitle language a video's bar shows, and which the viewer asked for. Shared by the YouTube and Bilibili bars.
export interface TrackInfo { id: string; label: string; language: string; auto: boolean }
export interface LanguageOption { id: string; label: string }

// "zh-CN" and "ai-zh" are both Chinese; "en-US" is English.
export const languageBase = (code: unknown): string => String(code ?? '').toLowerCase().replace(/_/g, '-').replace(/^ai-/, '').split('-')[0];

// The language spoken in the video comes first, not the viewer's own: an automatic track is made from the audio, so its
// language is the spoken one; with none, the track uploaded first. A language the viewer picked for this video wins.
// Within a language a hand-made track beats an automatic one.
export function chooseTrack<T extends TrackInfo>(tracks: T[], preferred?: string): T | undefined {
	if (!tracks.length) return undefined;
	const best = (list: T[]) => list.find(track => !track.auto) ?? list[0];
	if (preferred) { const wanted = tracks.filter(track => track.language === preferred); if (wanted.length) return best(wanted); }
	const spoken = tracks.find(track => track.auto)?.language;
	return spoken ? best(tracks.filter(track => track.language === spoken)) : tracks[0];
}
export const optionsOf = (tracks: TrackInfo[]): LanguageOption[] => tracks.map(({ id, label }) => ({ id, label }));

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
