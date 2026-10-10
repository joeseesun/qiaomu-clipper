// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { cacheKeyFor, chooseTrack, languageBase, optionsOf, saveLanguage, savedLanguage, type TrackInfo } from './subtitle-language';

const t = (id: string, language: string, auto = false, label = id): TrackInfo => ({ id, label, language, auto });
beforeEach(() => localStorage.clear());

it('treats the usual language codes as one language', () => {
	expect([languageBase('zh-CN'), languageBase('ai-zh'), languageBase('en_US'), languageBase('EN'), languageBase(undefined), languageBase('ai-en')]).toEqual(['zh', 'zh', 'en', 'en', '', 'en']);
});

it('defaults to the language spoken in the video, not Chinese and not the viewer\'s own', () => {
	// English interview with an automatic English track and a hand-made Chinese translation: show the English.
	expect(chooseTrack([t('zh-CN', 'zh'), t('ai-en', 'en', true)])?.id).toBe('ai-en');
	// Chinese lecture with an automatic Chinese track and an English translation: show the Chinese.
	expect(chooseTrack([t('en', 'en'), t('ai-zh', 'zh', true)])?.id).toBe('ai-zh');
	// A hand-made track in the spoken language beats the automatic one.
	expect(chooseTrack([t('ai-en', 'en', true), t('en', 'en'), t('zh-CN', 'zh')])?.id).toBe('en');
	// With no original-language evidence, fall back to Chinese, then English.
	expect(chooseTrack([t('en', 'en'), t('zh-CN', 'zh')])?.id).toBe('zh-CN'); expect(chooseTrack([t('zh-CN', 'zh'), t('en', 'en')])?.id).toBe('zh-CN');
	expect(chooseTrack([])).toBeUndefined(); expect(chooseTrack([t('ja', 'ja')])?.id).toBe('ja');
});

it('uses the language the viewer picked when the video has it, and the spoken one otherwise', () => {
	const tracks = [t('zh-CN', 'zh'), t('ai-en', 'en', true), t('en', 'en')];
	expect(chooseTrack(tracks, 'zh')?.id).toBe('zh-CN'); expect(chooseTrack(tracks, 'en')?.id).toBe('en');
	expect(chooseTrack(tracks, 'ko')?.id).toBe('en'); expect(optionsOf(tracks)).toEqual([{ id: 'zh-CN', label: 'zh-CN' }, { id: 'ai-en', label: 'ai-en' }, { id: 'en', label: 'en' }]);
});

it('remembers the choice per video, never as a rule for every video, and keeps only the most recent', () => {
	saveLanguage('bilibili:BV1:1', 'en'); saveLanguage('youtube:abcdefghijk', 'zh');
	expect(savedLanguage('bilibili:BV1:1')).toBe('en'); expect(savedLanguage('youtube:abcdefghijk')).toBe('zh'); expect(savedLanguage('bilibili:BV2:1')).toBeUndefined();
	saveLanguage('x', 'not a language!'); expect(savedLanguage('x')).toBeUndefined();
	for (let i = 0; i < 70; i++) saveLanguage('v' + i, 'en');
	expect(savedLanguage('bilibili:BV1:1')).toBeUndefined(); expect(savedLanguage('v69')).toBe('en'); expect(Object.keys(JSON.parse(localStorage.getItem('qiaomuBarLanguages')!))).toHaveLength(60);
	localStorage.setItem('qiaomuBarLanguages', 'not json'); expect(savedLanguage('v69')).toBeUndefined();
});

it('keys a cached transcript by the language the viewer chose', () => { expect(cacheKeyFor('youtube:abcdefghijk')).toBe('youtube:abcdefghijk'); expect(cacheKeyFor('youtube:abcdefghijk', 'zh')).toBe('youtube:abcdefghijk#zh'); });

it('does not mistake the first of several auto-caption languages for the original', () => {
 const tracks = [t('ar-auto', 'ar', true), t('en-auto', 'en', true), t('zh', 'zh')];
 expect(chooseTrack(tracks)?.id).toBe('zh');
 expect(chooseTrack(tracks.slice(0, 2))?.id).toBe('en-auto');
});

it('uses explicitly original audio captions ahead of Chinese and English', () => {
 const tracks = [t('ar-auto', 'ar', true), t('zh', 'zh'), {...t('fr-auto', 'fr', true), original: true}, {...t('fr', 'fr'), original: true}, t('en', 'en')];
 expect(chooseTrack(tracks)?.id).toBe('fr');
 expect(chooseTrack(tracks, 'en')?.id).toBe('en');
});

it('names caption languages in the app language without changing the selected track IDs or source-language ranking', () => {
 const tracks = [{...t('en-auto', 'en', true, '英语（自动生成）'),languageCode:'en'}, {...t('zh-Hant', 'zh', false, 'Chinese'),languageCode:'zh-Hant'}];
 const options = optionsOf(tracks, 'fr', 'généré automatiquement');
 expect(options[0]).toEqual({id:'en-auto',label:'anglais (généré automatiquement)'});
 expect(options[1].label).toContain('traditionnel');
 expect(chooseTrack(tracks)?.id).toBe('en-auto');
 expect(optionsOf([{...t('unknown','not a language', false, 'Source title')}], 'fr')[0].label).toBe('Source title');
});
