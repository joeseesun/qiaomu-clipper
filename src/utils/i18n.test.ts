// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getCurrentLanguage, getEffectiveLanguage, initializeI18n, getMessage, matchBrowserLanguage } from './i18n';
import { setUiLanguage, uiLanguage } from './ui-text';
const state = vi.hoisted(() => ({saved: '' as unknown, browser: 'en-US'}));
vi.mock('./storage-utils', () => ({getLocalStorage:async()=>state.saved,setLocalStorage:vi.fn()}));
vi.mock('./browser-polyfill', () => ({default:{i18n:{getUILanguage:()=>state.browser,getMessage:()=>''}}}));
afterEach(()=>{state.saved='';state.browser='en-US';setUiLanguage(undefined)});
it('keeps a saved regional language consistent in the selector, text and message systems', async()=>{
 state.saved='fr-CA';state.browser='zh-CN';
 expect(await getCurrentLanguage()).toBe('fr');
 expect(await getEffectiveLanguage()).toEqual({code:'fr',isRTL:false});
 await initializeI18n();expect(uiLanguage()).toBe('fr');
 expect(getMessage('youtubeBarSearch')).toBe('Rechercher dans la transcription');
});
it('uses the full browser language when following the system default', async()=>{
 state.browser='zh-HK';expect(matchBrowserLanguage()).toBe('zh_TW');
 state.browser='pt-BR';expect((await getEffectiveLanguage()).code).toBe('pt_BR');
});
it('ignores invalid storage values and applies the browser default', async()=>{
 state.saved=42;state.browser='ja-JP';expect(await getCurrentLanguage()).toBe('');
 expect((await getEffectiveLanguage()).code).toBe('ja');
});
