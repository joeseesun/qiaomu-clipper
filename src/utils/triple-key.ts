// Press the same plain key three times quickly (outside text fields and open dialogs) to run an action.
export const TRIPLE_KEY_WINDOW_MS = 600;

export type TripleCommand = 'read' | 'edit' | 'clip' | 'note';
export type TripleKeyMap = Record<TripleCommand, string>;
export const DEFAULT_TRIPLE_KEYS: TripleKeyMap = { read: 'a', edit: 'e', clip: 'q', note: 'i' };
export const TRIPLE_COMMANDS: TripleCommand[] = ['read', 'edit', 'clip', 'note'];

// One lowercase letter or digit per command; empty turns a command off. A key can only be used once.
export function normalizeTripleKeys(raw: Partial<Record<TripleCommand, unknown>> | undefined | null): TripleKeyMap {
	const result: TripleKeyMap = { read: '', edit: '', clip: '', note: '' };
	const used = new Set<string>();
	for (const command of TRIPLE_COMMANDS) {
		const value = raw && command in raw ? String(raw[command] ?? '').trim().toLowerCase() : DEFAULT_TRIPLE_KEYS[command];
		if (/^[a-z0-9]$/.test(value) && !used.has(value)) { result[command] = value; used.add(value); }
	}
	return result;
}

// Reverse lookup: which command does this key trigger?
export function commandForKey(map: TripleKeyMap, key: string): TripleCommand | undefined {
	return TRIPLE_COMMANDS.find(command => map[command] && map[command] === key);
}

function isEditableTarget(event: KeyboardEvent): boolean {
	const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
	if (!target || !target.tagName) return false;
	return !!target.closest?.('dialog[open]') || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.getAttribute?.('role') === 'textbox';
}

export function listenTripleKey(keys: string[] | (() => string[]), onTriple: (key: string) => void, isEnabled: () => boolean = () => true): void {
	let lastKey = '';
	let count = 0;
	let lastAt = 0;
	document.addEventListener('keydown', event => {
		const key = event.key.toLowerCase();
		if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(typeof keys === 'function' ? keys() : keys).includes(key) || isEditableTarget(event) || !isEnabled()) {
			lastKey = ''; count = 0;
			return;
		}
		const now = Date.now();
		count = key === lastKey && now - lastAt < TRIPLE_KEY_WINDOW_MS ? count + 1 : 1;
		lastKey = key;
		lastAt = now;
		if (count === 3) { count = 0; lastKey = ''; onTriple(key); }
	}, true);
}

// Sites where the shortcuts stay off. Entries may be a bare domain, a URL, or `*.example.com`; subdomains are included.
export function normalizeSite(entry: string): string {
	let value = entry.trim().toLowerCase();
	if (!value) return '';
	value = value.replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').split(/[/?#:]/)[0].replace(/^www\./, '');
	return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value) ? value : '';
}

export function normalizeSites(entries: unknown): string[] {
	const list = Array.isArray(entries) ? entries : [];
	return Array.from(new Set(list.map(entry => normalizeSite(String(entry))).filter(Boolean)));
}

export function isSiteBlocked(hostname: string, entries: unknown): boolean {
	const host = hostname.toLowerCase().replace(/^www\./, '');
	return normalizeSites(entries).some(site => host === site || host.endsWith(`.${site}`));
}
