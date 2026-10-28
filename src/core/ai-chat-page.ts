import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n, translatePage } from '../utils/i18n';
import { t } from '../utils/ui-text';
import { mountClipChat } from '../utils/clip-chat';
import { snapshotAiPage, parseAiPage, sameAiPage, type AiSnapshot } from '../utils/ai-page-context';
import { consumeChatResume } from '../utils/chat-history-resume';
import { readConversation } from '../utils/chat-history';

async function start() {
	let disposed = false, refreshGeneration = 0;
	let chat: ReturnType<typeof mountClipChat> | undefined;
	let removeQuoteListener = () => {};
	function dispose() {
		if (disposed) return;
		disposed = true;
		refreshGeneration++;
		chat?.destroy();
		removeQuoteListener();
		window.removeEventListener('pagehide', dispose);
		window.removeEventListener('qiaomu-ai-dispose', dispose);
	}
	// Register before settings/i18n await: the parent can navigate during startup.
	window.addEventListener('pagehide', dispose);
	window.addEventListener('qiaomu-ai-dispose', dispose);
	await loadSettings();
	await initializeI18n();
	await translatePage();
	if (disposed) return;
	const params = new URLSearchParams(location.search);
	const tabId = Number(params.get('tab')), windowId = Number(params.get('window'));
	const expected = params.get('url') || '';
	let documentId: string | undefined;
	const quoteKey = 'qiaomuSelectionQuote:' + tabId;
	let quoteQueue = Promise.resolve();
	async function consumeQuote() {
		quoteQueue = quoteQueue.catch(() => {}).then(async () => {
		if (!chat || disposed) return;
		const value = (await browser.storage.session.get(quoteKey))[quoteKey] as { text?: string; url?: string; at?: number } | undefined;
		if (disposed || !value) return;
		await browser.storage.session.remove(quoteKey);
		if (typeof value.text === 'string' && value.url === expected && Date.now() - (value.at || 0) < 30_000) chat.quote(value.text);
		});
		await quoteQueue;
	}
	const quoteChanged = (changes: Record<string, unknown>, area: string) => { if (area === 'session' && changes[quoteKey]) void consumeQuote(); };
	browser.storage.onChanged.addListener(quoteChanged);
	removeQuoteListener = () => browser.storage.onChanged.removeListener(quoteChanged);
	let context = { title: t('普通对话'), url: expected || `qiaomu-chat://tab/${tabId}`, markdown: '', available: false };
	const pageChanged = () => new Error(t('页面已切换，请在当前页重新提问。'));
	async function assertCurrent(generation: number) {
		const [tab] = await browser.tabs.query({ active: true, windowId });
		if (disposed || generation !== refreshGeneration || tab?.id !== tabId || tab.status === 'loading' || !sameAiPage(expected, tab.url || '')) throw pageChanged();
	}
	async function refresh() {
		const generation = ++refreshGeneration;
		await assertCurrent(generation);
		let snapshot: AiSnapshot | undefined;
		let snapshotDocument: string | undefined;
		if (/^https?:\/\//.test(expected)) {
			try {
				const [result] = await browser.scripting.executeScript({ target: { tabId }, func: snapshotAiPage });
				snapshot = result?.result as AiSnapshot | undefined;
				// Chrome 106+ supplies this field; the cross-browser polyfill types omit it.
				snapshotDocument = (result as { documentId?: string } | undefined)?.documentId;
			} catch { /* Missing host access: offer ordinary chat after rechecking the tab. */ }
		}
		// A different document is navigation, not a permission failure. Never reuse its history.
		if (snapshot && (!sameAiPage(expected, snapshot.url) || (documentId && snapshotDocument !== documentId))) throw pageChanged();
		const parsed = snapshot ? parseAiPage(snapshot) : { title: t('普通对话'), url: context.url, markdown: '' };
		await assertCurrent(generation);
		documentId = snapshotDocument || documentId;
		context = { ...parsed, available: Boolean(parsed.markdown) };
		if (!context.markdown) context.markdown = '[No page content is available. Do not claim to have read this page.]';
		return snapshot?.selection || '';
	}
	try { await refresh(); } catch { dispose(); return; }
	if (disposed) return;
	const resume = await consumeChatResume(tabId, expected).catch(() => undefined);
	const initialConversation = resume ? await readConversation(resume.pageKey, resume.id) : undefined;
	if (disposed) return;
	chat = mountClipChat({
		initialConversation,
		getContext: () => context,
		prepareContext: async () => { await refresh(); },
		getSelection: refresh,
		preserveUrlHash: true,
		onClose: () => { dispose(); parent.postMessage('close-ai-sidebar', location.origin); },
	});
	chat.toggle(true);
	await consumeQuote();
}
void start();
