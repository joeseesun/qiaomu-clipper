export type ShortcutContext = { tabId: number; action: 'read' | 'edit' | 'clip' | 'writeSource' };

// This URL is owned by the extension; never infer the source from the currently focused tab.
export function readShortcutContext(search: string): ShortcutContext | undefined {
	const params = new URLSearchParams(search);
	if (params.get('context') !== 'shortcut') return;
	const rawId = params.get('tabId') ?? '';
	const tabId = Number(rawId);
	const action = params.get('action');
	if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(tabId) || tabId <= 0) return;
	if (action !== 'read' && action !== 'edit' && action !== 'clip' && action !== 'writeSource') return;
	return { tabId, action };
}
