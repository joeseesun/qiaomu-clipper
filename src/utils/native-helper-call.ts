import browser from './browser-polyfill';
import { localizeHelperReply, setUiLanguage } from './ui-text';

// Every request to the local helper goes through here, so what it says back (in Chinese) reaches the person in their own language.
export async function callHelper(payload: unknown): Promise<unknown> {
	const reply = await browser.runtime.sendNativeMessage('ai.qiaomu.clipper', payload);
	try { const { language } = await browser.storage.local.get('language'); setUiLanguage(typeof language === 'string' ? language : undefined); } catch { /* the browser's language decides */ }
	return localizeHelperReply(reply);
}
