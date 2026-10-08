// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createContentText } from './content-i18n';
import { setUiLanguage } from './ui-text';
afterEach(() => setUiLanguage(undefined));
it('uses the app language on a website even when its browser language is English', async () => {
 const text = await createContentText({ storage: { local: { get: vi.fn(async () => ({language:'zh_TW'})) } } },'en-US');
 expect(text('youtubeBarSearch','搜索字幕','Search transcript')).toBe('搜尋字幕');
});
it('uses browser script/region when app language is system default', async () => {
 const text = await createContentText({ storage: { local: { get: vi.fn(async () => ({language:''})) } } },'zh-HK');
 expect(text('youtubeBarSearch','搜索字幕','Search transcript')).toBe('搜尋字幕');
});
it('falls back to English when storage is unavailable and locale is unsupported', async () => {
 const text = await createContentText({ storage: { local: { get: vi.fn(async () => {throw new Error('updated')}) } } },'xx');
 expect(text('missing','未知','Unknown')).toBe('Unknown');
});

it('uses the selected French language for website subtitle controls even in an English browser', async () => {
 const text = await createContentText({storage:{local:{get:vi.fn(async()=>({language:'fr'}))}}}, 'en-US');
 expect(text('youtubeBarSearch','搜索字幕','Search transcript')).toBe('Rechercher dans la transcription');
});

it('follows the same browser UI locale as extension settings in system-default mode', async()=>{
 const text = await createContentText({i18n:{getUILanguage:()=> 'zh-HK'},storage:{local:{get:vi.fn(async()=>({language:''}))}}});
 expect(text('youtubeBarSearch','搜索字幕','Search transcript')).toBe('搜尋字幕');
});
