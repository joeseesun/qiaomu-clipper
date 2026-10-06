export const TRANSLATION_TARGET_KEY = 'qiaomuTranslationTargetLanguage';
export const translationLanguages = [
	{ code: 'zh-CN', label: '简体中文' }, { code: 'zh-TW', label: '繁体中文' },
	{ code: 'en', label: 'English' }, { code: 'ja', label: '日本語' },
	{ code: 'ko', label: '한국어' }, { code: 'fr', label: 'Français' },
	{ code: 'es', label: 'Español' },
];
export const validTargetLanguage = (code?: string | null): string => translationLanguages.some(item => item.code === code) ? code! : 'zh-CN';
export function languageLabel(code?: string): string {
	const normalized = code?.replace(/^ai-/, '').replace('_', '-');
	return translationLanguages.find(item => item.code.toLowerCase() === normalized?.toLowerCase())?.label || normalized || 'Unknown';
}

// Script checks are a low-confidence hint, never evidence of a caption track's language.
export function detectTranscriptLanguage(text: string): string | undefined {
	if (/[\u3040-\u30ff]/.test(text)) return 'ja';
	if (/[\uac00-\ud7af]/.test(text)) return 'ko';
	if (/[\u0600-\u06ff]/.test(text)) return 'ar';
	if (/[\u3400-\u9fff]/.test(text)) return 'zh-CN';
	if (/\b(the|and|is|are|this|that|with|you|have)\b/i.test(text)) return 'en';
	return undefined;
}
