import browser from './browser-polyfill';
import { chatPageKey, chatSourceLink, chatSource, type ChatSource } from './chat-source';
import { openCurrentAiSidebar } from './ai-sidebar';

const PREFIX = 'qiaomu-chat-resume:';
// The hand-off contains only IDs and a URL, lives in memory (storage.session),
// and is bound to the exact newly opened tab. Nothing is added to the website URL.
export async function openChatSource(source: ChatSource, conversationId: string): Promise<void> {
	const url = chatSourceLink(source.url);
	if (!url) throw new Error('Original page URL is unavailable.');
	// Reader/editor pages may not have the native sidebar open yet. Start from
	// this explicit click; failure on browsers without sidePanel leaves the link usable.
	void openCurrentAiSidebar().catch(() => {});
	const tab = await browser.tabs.create({ url, active: false });
	if (tab.id === undefined) throw new Error('Could not open the original page.');
	// Even if session storage is unavailable/full, the user's original link
	// must still open. Report the hand-off failure instead of stranding a tab.
	try {
		await browser.storage.session.set({ [PREFIX + tab.id]: { id: conversationId, source: chatSource(source), createdAt: Date.now() } });
	} finally { await browser.tabs.update(tab.id, { active: true }); }
}

export async function consumeChatResume(tabId: number, url: string): Promise<{ id: string; pageKey: string } | undefined> {
	const key = PREFIX + tabId;
	const value = (await browser.storage.session.get(key))[key] as { id?: string; source?: ChatSource; createdAt?: number } | undefined;
	if (!value) return;
	await browser.storage.session.remove(key);
	if (!value.source || typeof value.id !== 'string' || !value.createdAt || Date.now() - value.createdAt > 10 * 60 * 1000) return;
	const pageKey = chatPageKey(value.source.url, value.source.preserveUrlHash);
	if (pageKey !== chatPageKey(url, value.source.preserveUrlHash)) return;
	return { id: value.id, pageKey };
}
