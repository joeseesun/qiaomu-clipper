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
	// No automatic track says nothing about the audio: the track uploaded first.
	expect(chooseTrack([t('en', 'en'), t('zh-CN', 'zh')])?.id).toBe('en'); expect(chooseTrack([t('zh-CN', 'zh'), t('en', 'en')])?.id).toBe('zh-CN');
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
