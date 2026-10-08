import browser from '../browser-polyfill';

import { t } from '../ui-text';
export function randomString(length: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'[b % 66]).join('');
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomString(64);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function jwtClaims(token: string | undefined): Record<string, any> {
	try {
		const part = (token || '').split('.')[1];
		if (!part) return {};
		const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
		return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, c => c.charCodeAt(0))));
	} catch { return {}; }
}

export interface SignInHandle {
	result: Promise<URL>;
	// A browser that cannot show the redirect can paste its address instead.
	submitUrl(raw: string): boolean;
	cancel(): void;
}

// Opens the vendor's sign-in page and resolves with the address the browser is
// sent back to. Nothing listens there: the redirect is read from the tab.
export function openSignIn(authorizeUrl: string, redirectPrefix: string, timeoutMs = 10 * 60 * 1000): SignInHandle {
	let tabId: number | undefined;
	let finished = false;
	let resolve!: (url: URL) => void;
	let reject!: (error: Error) => void;
	const result = new Promise<URL>((res, rej) => { resolve = res; reject = rej; });
	const timer = setTimeout(() => end(new Error(t('登录超时，请重试'))), timeoutMs);

	const onUpdated = (id: number, info: { url?: string }, tab: { url?: string }) => {
		if (id !== tabId) return;
		const url = info.url || tab.url;
		if (url && url.startsWith(redirectPrefix)) end(undefined, new URL(url));
	};
	const onRemoved = (id: number) => { if (id === tabId) end(new Error(t('登录窗口已关闭'))); };

	function end(error?: Error, url?: URL) {
		if (finished) return;
		finished = true;
		clearTimeout(timer);
		browser.tabs.onUpdated.removeListener(onUpdated as any);
		browser.tabs.onRemoved.removeListener(onRemoved);
		if (tabId !== undefined) void browser.tabs.remove(tabId).catch(() => {});
		if (url) resolve(url); else reject(error || new Error(t('登录已取消')));
	}

	browser.tabs.onUpdated.addListener(onUpdated as any);
	browser.tabs.onRemoved.addListener(onRemoved);
	browser.tabs.create({ url: authorizeUrl }).then(tab => { tabId = tab.id; }, error => end(error instanceof Error ? error : new Error(String(error))));

	return {
		result,
		submitUrl(raw) {
			try {
				const url = new URL(raw.trim());
				if (!url.href.startsWith(redirectPrefix)) return false;
				end(undefined, url);
				return true;
			} catch { return false; }
		},
		cancel: () => end(new Error(t('登录已取消')))
	};
}
