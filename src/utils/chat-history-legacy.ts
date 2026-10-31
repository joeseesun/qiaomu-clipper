import browser from './browser-polyfill';
import { chatPageKey } from './chat-source';

export interface LegacyCleanup { key: string; mode: 'exact' | 'selected' | 'all'; hash: string; ids: string[]; pageKey?: string; unknown?: boolean }
export const legacyKey = (url: string) => { let n = 5381; for (let i = 0; i < url.length; i++) n = ((n << 5) + n + url.charCodeAt(i)) | 0; return `qiaomuChat:${(n >>> 0).toString(36)}`; };
export function legacyPage(key: string, article: { url?: unknown }): string | undefined {
	if (typeof article?.url !== 'string') return;
	return chatPageKey(article.url, key !== legacyKey(chatPageKey(article.url)));
}
async function fingerprint(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function legacyCleanupPlan(records: Record<string, unknown>, target?: { pageKey: string; id: string }, exactKeys?: Set<string>): Promise<LegacyCleanup[]> {
	const plan: LegacyCleanup[] = [];
	for (const [key, raw] of Object.entries(records)) {
		if (!key.startsWith('qiaomuChat:') || (exactKeys && !exactKeys.has(key))) continue;
		const value = raw as { url?: string; conversations?: { id?: unknown }[] } | null;
		const chats = Array.isArray(value?.conversations) ? value.conversations : [];
		const ids = chats.flatMap(chat => typeof chat?.id === 'string' ? [chat.id] : []);
		if (target && (legacyPage(key, value!) !== target.pageKey || !ids.includes(target.id))) continue;
		plan.push({ key, mode: exactKeys ? 'exact' : target ? 'selected' : 'all', hash: await fingerprint(raw), ids: target ? [target.id] : ids,
			...(target ? { pageKey: target.pageKey } : {}), unknown: !Array.isArray(value?.conversations) || ids.length !== chats.length });
	}
	return plan;
}
// Idempotent and scoped: retries remove only the original selection. New chats
// added to the same legacy page after a failed clear are not part of that clear.
export async function cleanLegacyHistory(plan: LegacyCleanup[]): Promise<Record<string, unknown>> {
	for (const item of plan) {
		const raw = (await browser.storage.local.get(item.key))[item.key];
		if (raw === undefined) continue;
		if (await fingerprint(raw) === item.hash) {
			if (item.mode !== 'selected') {
				await browser.storage.local.remove(item.key);
				if ((await browser.storage.local.get(item.key))[item.key] !== undefined) throw new Error('Legacy history could not be removed');
				continue;
			}
		} else if (item.mode === 'exact') throw new Error('Legacy history changed during migration');
		const value = raw as { url?: string; conversations?: { id?: unknown }[] } | null;
		if (!Array.isArray(value?.conversations) || (item.pageKey && legacyPage(item.key, value) !== item.pageKey)) throw new Error('Legacy history changed; cleanup could not be verified');
		const remaining = value.conversations.filter(chat => !item.ids.includes(String(chat?.id)));
		if (item.mode === 'all' && item.unknown) throw new Error('Unrecognized legacy history changed; clear history again to include it');
		if (!remaining.length) await browser.storage.local.remove(item.key);
		else if (remaining.length !== value.conversations.length) await browser.storage.local.set({ [item.key]: { ...value, conversations: remaining } });
		const after = (await browser.storage.local.get(item.key))[item.key] as typeof value;
		if (after?.conversations?.some(chat => item.ids.includes(String(chat?.id)))) throw new Error('Legacy history could not be removed');
	}
	const remaining = await browser.storage.local.get(null);
	const keys = new Set(Object.keys(remaining).filter(key => key.startsWith('qiaomuChat:')));
	if ('qiaomuChatIndex' in remaining) {
		const index = remaining.qiaomuChatIndex;
		if (!keys.size) await browser.storage.local.remove('qiaomuChatIndex');
		else if (Array.isArray(index)) {
			const kept = index.filter(item => keys.has(item?.key));
			if (kept.length !== index.length) await browser.storage.local.set({ qiaomuChatIndex: kept });
		}
	}
	return remaining;
}
