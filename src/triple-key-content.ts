import { listenTripleKey, normalizeTripleKeys, commandForKey, isSiteBlocked, TripleKeyMap } from './utils/triple-key';

// Runs in every frame of every web page (and is injected into tabs that were already open at install time).
// Press a configured key three times: reading mode / edit / clip with the default template (defaults a, e, q).
declare global { interface Window { qiaomuTripleKeyDispose?: () => void; qiaomuTripleKeyGeneration?: number } }

try {
	{
		// Every injection replaces the listener, including after an extension reload.
		// A generation guard also retires callbacks whose old context cannot be disposed.
		const generation = (window.qiaomuTripleKeyGeneration ?? 0) + 1;
		window.qiaomuTripleKeyGeneration = generation;
		try { window.qiaomuTripleKeyDispose?.(); } catch { /* invalidated old context */ }
		const current = () => window.qiaomuTripleKeyGeneration === generation;
		type Api = {
			runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
			storage: {
				sync?: { get(key: string): Promise<Record<string, any>> };
				onChanged: {
					addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void;
					removeListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void;
				};
			};
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		let enabled = false;
		let keys: TripleKeyMap = normalizeTripleKeys(undefined);
		const apply = (settings?: { tripleKeyShortcuts?: boolean; tripleKeys?: Partial<TripleKeyMap>; tripleKeyBlockedSites?: string[] }) => {
			if (!current()) return;
			enabled = settings?.tripleKeyShortcuts !== false && !isSiteBlocked(location.hostname, settings?.tripleKeyBlockedSites);
			keys = normalizeTripleKeys(settings?.tripleKeys);
		};
		if (api.storage.sync) api.storage.sync.get('general_settings').then(data => apply(data?.general_settings)).catch(() => apply());
		else apply();
		const onChanged = (changes: Record<string, { newValue?: any }>, area: string) => {
			if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue);
		};
		api.storage.onChanged.addListener(onChanged);
		const stop = listenTripleKey(() => Object.values(keys).filter(Boolean), key => {
			const command = commandForKey(keys, key);
			if (!command) return;
			try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command })?.catch?.(() => {}); } catch { /* next injection replaces this context */ }
		}, () => current() && enabled);
		window.qiaomuTripleKeyDispose = () => {
			stop();
			api.storage.onChanged.removeListener(onChanged);
		};
	}
} catch {
	// The extension may have been updated while this page was open.
}
