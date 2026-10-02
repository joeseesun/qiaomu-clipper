import { listenTripleKey, normalizeTripleKeys, commandForKey, isSiteBlocked, TripleKeyMap } from './utils/triple-key';

// Runs in every frame of every web page (and is injected into tabs that were already open at install time).
// Press a configured key three times: reading mode / edit / clip with the default template (defaults a, e, q).
declare global { interface Window { qiaomuTripleKeyLoaded?: boolean } }

try {
	if (!window.qiaomuTripleKeyLoaded) {
		window.qiaomuTripleKeyLoaded = true;
		type Api = {
			runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
			storage: {
				sync?: { get(key: string): Promise<Record<string, any>> };
				onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void };
			};
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		let enabled = true;
		let keys: TripleKeyMap = normalizeTripleKeys(undefined);
		const apply = (settings?: { tripleKeyShortcuts?: boolean; tripleKeys?: Partial<TripleKeyMap>; tripleKeyBlockedSites?: string[] }) => {
			enabled = settings?.tripleKeyShortcuts !== false && !isSiteBlocked(location.hostname, settings?.tripleKeyBlockedSites);
			keys = normalizeTripleKeys(settings?.tripleKeys);
		};
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => {
			if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue);
		});
		listenTripleKey(() => Object.values(keys).filter(Boolean), key => {
			const command = commandForKey(keys, key);
			if (!command) return;
			try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command })?.catch?.(() => {}); } catch { /* extension reloaded; the page needs a refresh */ }
		}, () => enabled);
	}
} catch {
	// The extension may have been updated while this page was open.
}
