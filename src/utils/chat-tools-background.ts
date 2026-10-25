import browser from './browser-polyfill';
import { loadWebSearch, saveWebSearch, selectedSearchProvider, searchWeb, fetchSearchPage } from './web-search';
import { loadUnsplashSource, searchUnsplash, unsplashDownloadUrl } from './image-library-sources';
import { normalizeChatTool, type ChatCapabilities } from './chat-tools-types';
import { generalSettings, loadSettings } from './storage-utils';
import { tokenPlanProfile } from './token-plan';

export async function executeChatTool(raw: any, signal: AbortSignal): Promise<unknown> {
	signal.throwIfAborted();
	if (raw?.type === 'capabilities') {
		const [web, images] = await Promise.all([loadWebSearch(), loadUnsplashSource()]);
		const provider = selectedSearchProvider(web);
		if (typeof raw.modelId === 'string') await loadSettings();
		const model = generalSettings.models.find(m => m.enabled && m.id === raw.modelId);
		const native = model ? tokenPlanProfile(generalSettings.providers.find(p => p.id === model.providerId), model.providerModelId) : undefined;
		return { web: !!native || !!provider, webEnabled: web.enabled, webProvider: native ? 'Token Plan' : provider || '', images: !!(images.key || images.proxy), fetch: !!native || !!provider, ...(native ? { native: native.tools } : {}) } satisfies ChatCapabilities;
	}
	if (raw?.type === 'set_search_enabled' && typeof raw.enabled === 'boolean') {
		const config = await loadWebSearch(); config.enabled = raw.enabled; await saveWebSearch(config); return { enabled: config.enabled };
	}
	if (raw?.type === 'download_image' && /^[\w-]{1,100}$/.test(raw.id)) {
		const source = await loadUnsplashSource();
		const url = await unsplashDownloadUrl(source, raw.id, signal, typeof raw.download === 'string' ? raw.download : undefined);
		const r = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		if (!/^image\/(jpeg|png|webp)/.test(r.headers.get('content-type') || '')) throw new Error('invalid-image');
		const bytes = new Uint8Array(await r.arrayBuffer());
		if (bytes.length > 12 * 1024 * 1024) throw new Error('image-too-large');
		let binary = ''; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
		return { base64: btoa(binary), type: r.headers.get('content-type') };
	}
	const call = normalizeChatTool(raw);
	if (!call) throw new Error('invalid-tool');
	if (call.type === 'search_images') {
		const source = await loadUnsplashSource();
		if (!source.key && !source.proxy) throw new Error('unsplash-unconfigured');
		if (/[\u3400-\u9fff]/u.test(call.query)) throw new Error('english-image-query-required');
		return { photos: await searchUnsplash(source, call.query, call.page, signal, call) };
	}
	const settings = await loadWebSearch();
	if (call.type === 'search_web') return { sources: await searchWeb(call.query, settings, signal) };
	if (call.type === 'read_web') return { sources: [await fetchSearchPage(call.url, settings, signal)] };
	throw new Error('invalid-tool');
}

// Each caller owns one bounded request. Closing/aborting the UI closes the port and aborts fetch.
export function handleChatToolPort(port: browser.Runtime.Port): void {
	if (port.name !== 'qiaomu-chat-tool') return;
	if (port.sender?.id !== browser.runtime.id || port.sender.tab?.incognito) { port.disconnect(); return; }
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
	port.onDisconnect.addListener(() => { clearTimeout(timer); controller.abort(); });
	let started = false;
	port.onMessage.addListener(async raw => {
		if (started) return; started = true;
		try {
			const result = await executeChatTool(raw, controller.signal);
			if (!controller.signal.aborted) port.postMessage({ result });
		} catch (error) { if (!controller.signal.aborted) port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
		finally { clearTimeout(timer); }
	});
}
