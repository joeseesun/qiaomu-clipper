import { getWebPageMedia, isTikTokMedia, snapshotDouyinPlayer, snapshotTikTokPlayer, tabMayLendTikTokMedia, tiktokVideoPath, validateDouyinTracks } from './utils/web-page-media';
import { submitQiaomuClip, QiaomuClip } from './utils/qiaomu-rss';
import browser from 'webextension-polyfill';
import { detectBrowser } from './utils/browser-detection';
import { updateCurrentActiveTab, isValidUrl, isBlankPage, isNormalPageUrl } from './utils/active-tab-manager';
import { TextHighlightData } from './utils/highlighter';
import { debounce } from './utils/debounce';
import { Settings } from './types/types';
import { debugLog } from './utils/debug';
import { describeHelperFailure } from './utils/native-helper-prompt';
import { incrementStat, loadSettings } from './utils/storage-utils';
import { enabledChatModels, streamChat } from './utils/chat-llm';
import { audioStudyPath, videoKey, videoStudyPath } from './utils/video-source';
import { isSiteOn, loadStudySites, siteOf } from './utils/study-sites';
import { isMediaItemAddress, webMediaAddress } from './utils/web-media-page';
import { hasStoredHighlights } from './utils/url-utils';
import { handleAsrMessage, handleLearningNativeMessage } from './utils/local-save';
import { enableYouTubeEmbedRule, disableYouTubeEmbedRule } from './utils/youtube-embed-rules';

browser.runtime.onMessage.addListener(handleLearningNativeMessage);
browser.runtime.onMessage.addListener(handleAsrMessage);

// Accept RSS writes only from our own extension pages, never a website content script.
const qiaomuInFlight = new Map<string, Promise<unknown>>();
const qiaomuLocalInFlight = new Map<string, Promise<unknown>>();
// A failed native call says why (not installed, extension not allowed, helper cannot start) instead of one generic line.
const helperDown = (error: unknown) => { const reason = error instanceof Error ? error.message : String(error); return { ok: false, reason, error: describeHelperFailure(reason) }; };

browser.runtime.onMessage.addListener((request: unknown, sender: browser.Runtime.MessageSender) => {
	const message = request as { action?: string; payload?: { requestId?: string; vaultPath?: string; vault?: string; folder?: string } };
	if (!['qiaomuLocalStatus', 'qiaomuLocalSave', 'qiaomuLocalConfigure', 'qiaomuLocalChooseVault', 'qiaomuLocalChooseFolder'].includes(message?.action || '')) return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(''))) return Promise.resolve({ ok: false, error: '无效的本地保存请求' });
	if (message.action === 'qiaomuLocalStatus') return browser.runtime.sendNativeMessage('ai.qiaomu.clipper', { action: 'status' }).catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
	if (message.action === 'qiaomuLocalChooseFolder') return browser.runtime.sendNativeMessage('ai.qiaomu.clipper', { action: 'chooseNoteFolder', vault: message.payload?.vault, folder: message.payload?.folder })
		.catch(error => ({ ...helperDown(error), error: `${describeHelperFailure(error instanceof Error ? error.message : String(error))}也可以手动填写相对路径。` }));
	if (message.action === 'qiaomuLocalChooseVault') return browser.runtime.sendNativeMessage('ai.qiaomu.clipper', { action: 'chooseVault' })
		.catch(helperDown);
	if (message.action === 'qiaomuLocalConfigure') {
		if (typeof message.payload?.vaultPath !== 'string') return Promise.resolve({ ok: false, error: '请输入笔记库路径' });
		return browser.runtime.sendNativeMessage('ai.qiaomu.clipper', { action: 'configure', vaultPath: message.payload.vaultPath })
			.catch(helperDown);
	}
	const payload = message.payload;
	if (!payload || !/^[a-zA-Z0-9-]{8,80}$/.test(payload.requestId || '')) return Promise.resolve({ ok: false, error: '保存请求标识无效' });
	const key = `qiaomuLocalPending:${payload.requestId}`;
	if (qiaomuLocalInFlight.has(key)) return qiaomuLocalInFlight.get(key);
	const job = browser.storage.local.set({ [key]: payload })
		.then(() => browser.runtime.sendNativeMessage('ai.qiaomu.clipper', { ...payload, action: 'save' }))
		.then(async result => { if ((result as { ok?: boolean })?.ok) await browser.storage.local.remove(key); return result; })
		.catch(() => ({ ok: false, error: '本地保存助手未连接，请检查安装后重试' }))
		.finally(() => qiaomuLocalInFlight.delete(key));
	qiaomuLocalInFlight.set(key, job);
	return job;
});
browser.runtime.onMessage.addListener((request: unknown, sender: browser.Runtime.MessageSender) => {
	const message = request as { action?: string; clip?: QiaomuClip };
	if (message?.action !== 'qiaomuSubmitClip') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')) || !message.clip) return Promise.resolve({ error: '无效的剪藏请求' });
	const clip = message.clip;
	const key = clip.url;
	if (qiaomuInFlight.has(key)) return qiaomuInFlight.get(key);
	const pendingKey = `qiaomuPending:${clip.url}`;
	const job = browser.storage.local.set({ [pendingKey]: clip })
		.then(() => submitQiaomuClip(clip))
		.then(async result => { if (result.accepted) await browser.storage.local.remove(pendingKey); return result; })
		.catch(error => ({ error: error instanceof Error ? error.message : 'RSS 同步失败' }))
		.finally(() => qiaomuInFlight.delete(key));
	qiaomuInFlight.set(key, job);
	return job;
});

const YOUTUBE_INNERTUBE_RULE_ID = 9002;

// Set Origin header on YouTube innertube API requests from the extension.
// YouTube doesn't accept chrome-extension://...
async function enableYouTubeInnertubeRule(): Promise<void> {
	const dnr = (typeof chrome !== 'undefined' && chrome.declarativeNetRequest)
		|| (typeof browser !== 'undefined' && (browser as any).declarativeNetRequest);
	if (!dnr) return;
	try {
		await dnr.updateSessionRules({
			removeRuleIds: [YOUTUBE_INNERTUBE_RULE_ID],
			addRules: [{
				id: YOUTUBE_INNERTUBE_RULE_ID,
				priority: 1,
				action: {
					type: 'modifyHeaders' as any,
					requestHeaders: [
						{ header: 'Origin', operation: 'set' as any, value: 'https://www.youtube.com' },
						{ header: 'Referer', operation: 'set' as any, value: 'https://www.youtube.com/' },
					]
				},
				condition: {
					urlFilter: '||youtube.com/youtubei/',
					resourceTypes: ['xmlhttprequest' as any],
					initiatorDomains: [chrome?.runtime?.id || ''].filter(Boolean),
				}
			}]
		});
	} catch { /* Firefox/Safari use webRequest or native messaging instead */ }
}

// Some video hosts only serve a request that names their own site as the referrer, so the study reader plays their files as if from that site.
// One row per site, only for hosts that need it (checked on live items): sending a referrer to a host that does not ask for one is pointless,
// and sending the wrong one is refused by some. Add a row when a site's video turns out not to play in the reader.
const MEDIA_REFERERS: Array<{ id: number; referer: string; domains: string[] }> = [
	{ id: 9004, referer: 'https://www.douyin.com/', domains: ['douyinvod.com'] },
	{ id: 9005, referer: 'https://www.tiktok.com/', domains: ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'] },
];
async function enableMediaRefererRules(): Promise<void> {
	const dnr = typeof chrome !== 'undefined' ? chrome.declarativeNetRequest : undefined;
	if (!dnr || !chrome.runtime?.id) return;
	try {
		await dnr.updateSessionRules({
			removeRuleIds: MEDIA_REFERERS.map(row => row.id),
			addRules: MEDIA_REFERERS.map(row => ({
				id: row.id, priority: 1,
				action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType, requestHeaders: [{ header: 'Referer', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: row.referer }] },
				condition: { requestDomains: row.domains, resourceTypes: ['media' as chrome.declarativeNetRequest.ResourceType, 'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType], initiatorDomains: [chrome.runtime.id] },
			})),
		});
	} catch { /* other browsers */ }
}

// Firefox/Safari: use webRequest.onBeforeSendHeaders to set Origin/Referer on
// YouTube innertube requests. Fallback for browsers where declarativeNetRequest
// doesn't work or isn't supported.
if (typeof browser !== 'undefined' && browser.webRequest?.onBeforeSendHeaders) {
	try {
		browser.webRequest.onBeforeSendHeaders.addListener(
			(details) => {
				// Only modify requests from tabs showing extension pages
				if (details.tabId && details.tabId > 0) {
					// Check asynchronously would be complex — instead check
					// if the request has an extension origin or referer
					const refHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'referer');
					const refValue = refHeader?.value || '';
					const originHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'origin');
					const originValue = originHeader?.value || '';
					const isFromExtension = refValue.startsWith('moz-extension://') || originValue.startsWith('moz-extension://')
						|| refValue.startsWith('safari-web-extension://') || originValue.startsWith('safari-web-extension://');
					if (!isFromExtension) return { requestHeaders: details.requestHeaders };
				}

				const headers = details.requestHeaders || [];
				const setHeader = (name: string, value: string) => {
					const existing = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
					if (existing) {
						existing.value = value;
					} else {
						headers.push({ name, value });
					}
				};
				setHeader('Origin', 'https://www.youtube.com');
				setHeader('Referer', 'https://www.youtube.com/');
				return { requestHeaders: headers };
			},
			{ urls: ['*://www.youtube.com/*'] },
			['blocking', 'requestHeaders']
		);
	} catch { /* webRequest not available */ }
}

let sidePanelOpenWindows: Set<number> = new Set();
let highlighterModeState: { [tabId: number]: boolean } = {};
let readerModeState: { [tabId: number]: boolean } = {};
let hasHighlights = false;
let isContextMenuCreating = false;
let popupPorts: { [tabId: number]: browser.Runtime.Port } = {};
const contentScriptLoads = new Map<number, { url: string; promise: Promise<void> }>();
// Highlighter mode changes wait on lazy injection, so run them one at a time
// per tab. Otherwise two quick toggles both read the same starting state.
const highlighterModeQueues = new Map<number, Promise<unknown>>();

function queueHighlighterModeChange<T>(tabId: number, change: () => Promise<T>): Promise<T> {
	const previous = highlighterModeQueues.get(tabId) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(change);
	highlighterModeQueues.set(tabId, next);
	next.catch(() => {}).then(() => {
		if (highlighterModeQueues.get(tabId) === next) {
			highlighterModeQueues.delete(tabId);
		}
	});
	return next;
}

// A reload can replace the document without changing its URL. Invalidate the
// old document's pending load as soon as navigation starts so the replacement
// document can inject independently.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading') {
		contentScriptLoads.delete(tabId);
	}
});

async function injectContentScript(tabId: number): Promise<void> {
	if (browser.scripting) {
		debugLog('Clipper', 'Using scripting API');
		await browser.scripting.executeScript({
			target: { tabId },
			files: ['content.js']
		});
	} else {
		debugLog('Clipper', 'Using tabs.executeScript fallback');
		await browser.tabs.executeScript(tabId, { file: 'content.js' });
	}
	debugLog('Clipper', 'Injection completed, waiting for init...');

	// Poll until the content script responds, rather than a fixed delay.
	// Try immediately after injection, then back off with 50ms sleeps.
	let ready = false;
	for (let i = 0; i < 8; i++) {
		try {
			await browser.tabs.sendMessage(tabId, { action: "ping" });
			ready = true;
			break;
		} catch {
			// Not ready yet
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	if (!ready) {
		throw new Error('Content script did not respond after injection');
	}
	debugLog('Clipper', 'Post-injection ping succeeded');
}

async function ensureContentScriptLoadedInBackground(tabId: number): Promise<void> {
	// Resolve the current page before reusing an in-flight load. A tab can
	// navigate while injection is pending, and the new document must not reuse
	// work that was started for the previous URL.
	const tab = await browser.tabs.get(tabId);
	if (!tab.url || !isValidUrl(tab.url)) {
		throw new Error('Invalid URL for content script injection');
	}

	const existingLoad = contentScriptLoads.get(tabId);
	if (existingLoad?.url === tab.url) {
		return existingLoad.promise;
	}

	const load = (async () => {
		try {
			// Attempt to send a message to the content script
			await browser.tabs.sendMessage(tabId, { action: "ping" });
			debugLog('Clipper', 'Content script ping succeeded');
		} catch (error) {
			// If the message fails, the content script is not loaded, so inject it
			debugLog('Clipper', 'Ping failed, injecting content script...', error);
			await injectContentScript(tabId);
		}
	})();

	const entry = { url: tab.url, promise: load };
	contentScriptLoads.set(tabId, entry);
	try {
		await load;
	} finally {
		if (contentScriptLoads.get(tabId) === entry) {
			contentScriptLoads.delete(tabId);
		}
	}
}

async function sendMessageToContentScript(tabId: number, message: any): Promise<any> {
	await ensureContentScriptLoadedInBackground(tabId);
	return browser.tabs.sendMessage(tabId, message);
}

async function loadContentScriptForHighlights(tabId: number, rawUrl: string): Promise<boolean> {
	const [syncData, localData] = await Promise.all([
		browser.storage.sync.get('highlighter_settings'),
		browser.storage.local.get('highlights'),
	]);
	const highlighterSettings = syncData.highlighter_settings as { alwaysShowHighlights?: boolean } | undefined;
	if ((highlighterSettings?.alwaysShowHighlights ?? true) === false) {
		return false;
	}

	if (!hasStoredHighlights(localData.highlights, rawUrl)) {
		return false;
	}

	await ensureContentScriptLoadedInBackground(tabId);
	return true;
}

// Route a message to a tab, handling both normal pages (via content script)
// and extension pages like the reader page (via runtime.sendMessage forwarding).
async function routeMessageToTab(tabId: number, message: any): Promise<any> {
	const tab = await browser.tabs.get(tabId);
	if (isNormalPageUrl(tab.url)) {
		return sendMessageToContentScript(tabId, message);
	} else {
		return browser.runtime.sendMessage({
			action: 'extensionPageMessage',
			targetTabId: tabId,
			message
		});
	}
}

function getHighlighterModeForTab(tabId: number): boolean {
	return highlighterModeState[tabId] ?? false;
}

function getReaderModeForTab(tabId: number): boolean {
	return readerModeState[tabId] ?? false;
}

function isReaderPageUrl(url: string | undefined): string | null {
	if (!url) return null;
	const readerPagePrefix = browser.runtime.getURL('reader.html');
	if (url.startsWith(readerPagePrefix)) {
		try {
			const parsed = new URL(url);
			return parsed.searchParams.get('url');
		} catch {}
	}
	return null;
}

async function exitReaderPageIfNeeded(tabId: number, readerUrl?: string): Promise<boolean> {
	let originalUrl: string | null = null;
	try {
		const tab = await browser.tabs.get(tabId);
		originalUrl = isReaderPageUrl(tab.url);
	} catch {}

	// Fallback: the embedded clipper passes the reader URL when
	// tabs.get() can't access the extension page URL
	if (!originalUrl && readerUrl) {
		originalUrl = isReaderPageUrl(readerUrl);
	}

	if (originalUrl) {
		await browser.tabs.update(tabId, { url: originalUrl });
		readerModeState[tabId] = false;
		debouncedUpdateContextMenu(tabId);
		return true;
	}
	return false;
}

async function initialize() {
	try {
		// Set up tab listeners
		await setupTabListeners();

		browser.tabs.onRemoved.addListener((tabId) => {
			delete highlighterModeState[tabId];
			highlighterModeQueues.delete(tabId);
			delete readerModeState[tabId];
			contentScriptLoads.delete(tabId);
			void disableYouTubeEmbedRule(tabId).catch(() => {});
		});
		
		// Initialize context menu
		await debouncedUpdateContextMenu(-1);

		// Identify extension-page players before their iframe requests, then enable
		// Origin headers for YouTube innertube API requests.
		await enableYouTubeEmbedRule();
		await enableYouTubeInnertubeRule();
		await enableMediaRefererRules();

		// Set up action popup based on openBehavior setting
		await updateActionPopup();

		debugLog('Clipper', 'Background script initialized successfully');
	} catch (error) {
		console.error('Error initializing background script:', error);
	}
}

// Check if a popup is open for a given tab
function isPopupOpen(tabId: number): boolean {
	return popupPorts.hasOwnProperty(tabId);
}

browser.runtime.onConnect.addListener((port) => {
	if (port.name === 'popup') {
		const tabId = port.sender?.tab?.id;
		if (tabId) {
			popupPorts[tabId] = port;
			port.onDisconnect.addListener(() => {
				delete popupPorts[tabId];
			});
		}
	}
});

async function sendMessageToPopup(tabId: number, message: any): Promise<void> {
	if (isPopupOpen(tabId)) {
		try {
			await popupPorts[tabId].postMessage(message);
		} catch (error) {
			console.warn(`Error sending message to popup for tab ${tabId}:`, error);
		}
	}
}



// Safari: route fetch through native messaging (URLSession in Swift).
// Called from the background script where sendNativeMessage works reliably.
async function nativeFetch(url: string, options?: any): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
	try {
		const result = await browser.runtime.sendNativeMessage('application.id', {
			type: 'fetchRequest',
			url,
			method: options?.method || 'GET',
			headers: options?.headers || {},
			body: options?.body || null,
		}) as { ok: boolean; status: number; text: string; error?: string };
		return result || { ok: false, status: 0, text: '', error: 'Empty native response' };
	} catch (err) {
		return { ok: false, status: 0, text: '', error: (err as Error).message };
	}
}

// Fetch proxy for extension pages (reader, highlights).
// Returns a Promise for the webextension-polyfill.
// On Firefox MV3, host_permissions require explicit user grant —
// callers detect CORS_PERMISSION_NEEDED and prompt via permissions.request().
browser.runtime.onMessage.addListener((request: unknown) => {
	if (typeof request !== 'object' || request === null) return;
	if ((request as any).action !== 'fetchProxy') return;
	const { url, options } = request as { url: string; options?: any };
	const fetchOptions: RequestInit = {};
	if (options?.method) fetchOptions.method = options.method;
	if (options?.headers) fetchOptions.headers = options.headers;
	if (options?.body) fetchOptions.body = options.body;
	// Bilibili only returns subtitle tracks to a signed-in viewer; send cookies to its own hosts only.
	try { if (options?.credentials === 'include' && /(^|\.)(bilibili\.com|hdslb\.com)$/.test(new URL(url).hostname)) fetchOptions.credentials = 'include'; } catch { /* invalid URL: fetch reports it */ }
	return fetch(url, fetchOptions)
		.then(async (resp) => {
			const text = await resp.text();
			// If YouTube returns bot-detection HTML, try native messaging (Safari)
			if (!resp.ok && (text.includes('Sorry') || text.includes('<html')) && typeof browser.runtime.sendNativeMessage === 'function') {
				return nativeFetch(url, options);
			}
			return { ok: resp.ok, status: resp.status, text, finalUrl: resp.url };
		})
		.catch(async () => {
			// CORS failure — try native messaging (Safari), else report permission needed
			if (typeof browser.runtime.sendNativeMessage === 'function') {
				return nativeFetch(url, options);
			}
			return { ok: false, status: 0, text: '', error: 'CORS_PERMISSION_NEEDED' };
		});
});

browser.runtime.onMessage.addListener((request: unknown, sender: browser.Runtime.MessageSender, sendResponse: (response?: any) => void): true | undefined => {
	if (typeof request === 'object' && request !== null) {
		const typedRequest = request as { action: string; isActive?: boolean; hasHighlights?: boolean; tabId?: number; text?: string; section?: string; readerUrl?: string; url?: string };

		if (typedRequest.action === 'loadContentScriptForHighlights') {
			const tabId = sender.tab?.id;
			if (!tabId || !typedRequest.url) {
				sendResponse({ success: false, loaded: false });
				return true;
			}
			loadContentScriptForHighlights(tabId, typedRequest.url)
				.then((loaded) => sendResponse({ success: true, loaded }))
				.catch((error) => sendResponse({
					success: false,
					loaded: false,
					error: error instanceof Error ? error.message : String(error),
				}));
			return true;
		}

		if (typedRequest.action === 'copy-to-clipboard' && typedRequest.text) {
			// Use content script to copy to clipboard
			browser.tabs.query({active: true, currentWindow: true}).then(async (tabs) => {
				const currentTab = tabs[0];
				if (currentTab && currentTab.id) {
					try {
						const response = await routeMessageToTab(currentTab.id, {
							action: 'copy-text-to-clipboard',
							text: typedRequest.text
						});
						if ((response as any) && (response as any).success) {
							sendResponse({success: true});
						} else {
							sendResponse({success: false, error: 'Failed to copy from content script'});
						}
					} catch (err) {
						sendResponse({ success: false, error: (err as Error).message });
					}
				} else {
					sendResponse({success: false, error: 'No active tab found'});
				}
			});
			return true;
		}

		// fetchProxy is handled by a separate listener below

		if (typedRequest.action === "extractContent" && sender.tab && sender.tab.id) {
			sendMessageToContentScript(sender.tab.id, request).then(sendResponse);
			return true;
		}

		if (typedRequest.action === "ensureContentScriptLoaded") {
			const tabId = typedRequest.tabId || sender.tab?.id;
			if (tabId) {
				ensureContentScriptLoadedInBackground(tabId)
					.then(() => sendResponse({ success: true }))
					.catch((error) => sendResponse({ 
						success: false, 
						error: error instanceof Error ? error.message : String(error) 
					}));
				return true;
			} else {
				sendResponse({ success: false, error: 'No tab ID provided' });
				return true;
			}
		}

		if (typedRequest.action === "enableYouTubeEmbedRule" || typedRequest.action === "disableYouTubeEmbedRule") {
			const configure = typedRequest.action === "enableYouTubeEmbedRule" ? enableYouTubeEmbedRule : disableYouTubeEmbedRule;
			configure(sender.tab?.id).then(() => {
				sendResponse({ success: true });
			}).catch(error => {
				sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
			});
			return true;
		}

		if (typedRequest.action === "sidePanelOpened") {
			if (sender.tab && sender.tab.windowId) {
				sidePanelOpenWindows.add(sender.tab.windowId);
				updateCurrentActiveTab(sender.tab.windowId);
			}
		}

		if (typedRequest.action === "sidePanelClosed") {
			if (sender.tab && sender.tab.windowId) {
				sidePanelOpenWindows.delete(sender.tab.windowId);
			}
		}

		if (typedRequest.action === "highlighterModeChanged" && sender.tab && typedRequest.isActive !== undefined) {
			const tabId = sender.tab.id;
			if (tabId) {
				highlighterModeState[tabId] = typedRequest.isActive;
				sendMessageToPopup(tabId, { action: "updatePopupHighlighterUI", isActive: typedRequest.isActive });
				debouncedUpdateContextMenu(tabId);
			}
		}

		if (typedRequest.action === "readerModeChanged" && sender.tab && typedRequest.isActive !== undefined) {
			const tabId = sender.tab.id;
			if (tabId) {
				readerModeState[tabId] = typedRequest.isActive;
				debouncedUpdateContextMenu(tabId);
			}
			if (typedRequest.isActive === true) {
				incrementStat('readerMode', undefined, undefined, sender.tab.url, sender.tab.title)
					.catch((error) => debugLog('Reader', 'Failed to record reader mode stat:', error));
			}
		}

		if (typedRequest.action === "highlightsCleared" && sender.tab) {
			hasHighlights = false;
			debouncedUpdateContextMenu(sender.tab.id!);
		}

		if (typedRequest.action === "updateHasHighlights" && sender.tab && typedRequest.hasHighlights !== undefined) {
			hasHighlights = typedRequest.hasHighlights;
			debouncedUpdateContextMenu(sender.tab.id!);
		}

		if (typedRequest.action === "getHighlighterMode") {
			const tabId = typedRequest.tabId || sender.tab?.id;
			if (tabId) {
				sendResponse({ isActive: getHighlighterModeForTab(tabId) });
			} else {
				sendResponse({ isActive: false });
			}
			return true;
		}

		if (typedRequest.action === "getReaderMode") {
			const tabId = typedRequest.tabId || sender.tab?.id;
			if (tabId) {
				sendResponse({ isActive: getReaderModeForTab(tabId) });
			} else {
				sendResponse({ isActive: false });
			}
			return true;
		}

		if (typedRequest.action === "toggleHighlighterMode" && typedRequest.tabId) {
			toggleHighlighterMode(typedRequest.tabId)
				.then(newMode => sendResponse({ success: true, isActive: newMode }))
				.catch(error => sendResponse({ success: false, error: error.message }));
			return true;
		}

		if (typedRequest.action === "openPopup") {
			openPopup()
				.then(() => {
					sendResponse({ success: true });
				})
				.catch((error: unknown) => {
					console.error('Error opening popup in background script:', error);
					sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
				});
			return true;
		}

		if (typedRequest.action === "toggleReaderMode" && typedRequest.tabId) {
			const tabId = typedRequest.tabId;
			(async () => {
				// Check if the tab is on the extension's reader.html page
				const wasReaderPage = await exitReaderPageIfNeeded(tabId, typedRequest.readerUrl);
				if (wasReaderPage) {
					sendResponse({ success: true, isActive: false });
					return;
				}
				sendResponse(await toggleReaderModeInTab(tabId));
			})().catch(() => {
				// Page may have reloaded before responding (reader restore)
				sendResponse({ success: true, isActive: false });
			});
			return true;
		}

		if (typedRequest.action === "closeIframe") {
			if (sender.tab?.id) routeMessageToTab(sender.tab.id, { action: "close-iframe" }).catch(() => {});
			return undefined;
		}

		if (typedRequest.action === "qiaomuTripleKey") {
			const tab = sender.tab;
			if (tab?.id && tab.url && isValidUrl(tab.url) && !isBlankPage(tab.url)) {
				void runTripleKeyAction(String((typedRequest as { command?: string }).command), tab.id);
			}
			return undefined;
		}

		if (typedRequest.action === "getActiveTabAndToggleIframe") {
			browser.tabs.query({active: true, currentWindow: true}).then(async (tabs) => {
				const currentTab = tabs[0];
				if (currentTab && currentTab.id) {
					try {
						await routeMessageToTab(currentTab.id, { action: "toggle-iframe" });
						sendResponse({success: true});
					} catch (error) {
						console.error('Error sending toggle-iframe message:', error);
						sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
					}
				} else {
					sendResponse({success: false, error: 'No active tab found'});
				}
			});
			return true;
		}

		if (typedRequest.action === "toggleIframe") {
			const tab = sender.tab;
			if (tab?.id) {
				routeMessageToTab(tab.id, { action: "toggle-iframe" })
					.then(() => sendResponse({ success: true }))
					.catch((error) => {
						console.error('Error toggling iframe:', error);
						sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
					});
			} else {
				sendResponse({ success: false, error: 'Cannot open iframe on this page' });
			}
			return true;
		}

		if (typedRequest.action === "getActiveTab") {
			browser.tabs.query({active: true, currentWindow: true}).then(async (tabs) => {
				let currentTab = tabs[0];
				// Fallback for when currentWindow has no tabs (e.g., debugging popup in DevTools)
				if (!currentTab || !currentTab.id) {
					const allActiveTabs = await browser.tabs.query({active: true});
					currentTab = allActiveTabs.find(tab =>
						tab.id && tab.url && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('moz-extension://')
					) || allActiveTabs[0];
				}
				if (currentTab && currentTab.id) {
					sendResponse({tabId: currentTab.id});
				} else {
					sendResponse({error: 'No active tab found'});
				}
			});
			return true;
		}

		if (typedRequest.action === "openOptionsPage") {
			try {
				if (typeof browser.runtime.openOptionsPage === 'function') {
					// Chrome way
					browser.runtime.openOptionsPage();
				} else {
					// Firefox way
					browser.tabs.create({
						url: browser.runtime.getURL('settings.html')
					});
				}
				sendResponse({success: true});
			} catch (error) {
				console.error('Error opening options page:', error);
				sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
			}
			return true;
		}

		if (typedRequest.action === "openHighlights") {
			const domain = (typedRequest as any).domain;
			const query = domain ? `?domain=${encodeURIComponent(domain)}` : '';
			browser.tabs.create({ url: browser.runtime.getURL(`highlights.html${query}`) });
			sendResponse({ success: true });
			return true;
		}

		if (typedRequest.action === "openSettings") {
			try {
				const section = typedRequest.section ? `?section=${typedRequest.section}` : '';
				browser.tabs.create({
					url: browser.runtime.getURL(`settings.html${section}`)
				});
				sendResponse({success: true});
			} catch (error) {
				console.error('Error opening settings:', error);
				sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
			}
			return true;
		}

		if (typedRequest.action === "copyMarkdownToClipboard" || typedRequest.action === "saveMarkdownToFile") {
			if (sender.tab?.id) {
				routeMessageToTab(sender.tab.id, { action: typedRequest.action })
					.then(() => sendResponse({success: true}))
					.catch((error) => sendResponse({success: false, error: error instanceof Error ? error.message : String(error)}));
				return true;
			}
		}

		if (typedRequest.action === "getTabInfo") {
			browser.tabs.get(typedRequest.tabId as number).then((tab) => {
				// For reader page tabs, return the article URL so the
				// clipper treats it as a normal web page
				const url = isReaderPageUrl(tab.url) ?? tab.url;
				sendResponse({
					success: true,
					tab: {
						id: tab.id,
						url: url
					}
				});
			}).catch((error) => {
				console.error('Error getting tab info:', error);
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
			return true;
		}

		if (typedRequest.action === "forceInjectContentScript") {
			const tabId = typedRequest.tabId;
			if (tabId) {
				injectContentScript(tabId)
					.then(() => sendResponse({ success: true }))
					.catch((error) => {
						console.error('[Obsidian Clipper] forceInjectContentScript failed:', error);
						sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
					});
				return true;
			} else {
				sendResponse({ success: false, error: 'Missing tabId' });
				return true;
			}
		}

		if (typedRequest.action === "sendMessageToTab") {
			const tabId = (typedRequest as any).tabId;
			const message = (typedRequest as any).message;
			if (tabId && message) {
				routeMessageToTab(tabId, message).then((response) => {
					sendResponse(response);
				}).catch((error) => {
					console.error('[Obsidian Clipper] Error sending message to tab:', error);
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
				return true;
			} else {
				sendResponse({
					success: false,
					error: 'Missing tabId or message'
				});
				return true;
			}
		}

		if (typedRequest.action === "openReaderPage") {
			const articleUrl = (typedRequest as any).url;
			if (articleUrl && sender.tab?.id) {
				const readerUrl = browser.runtime.getURL('reader.html?url=' + encodeURIComponent(articleUrl));
				browser.tabs.update(sender.tab.id, { url: readerUrl })
					.then(() => sendResponse({ success: true }))
					.catch((error) => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
			} else {
				sendResponse({ success: false, error: 'Missing URL or tab' });
			}
			return true;
		}

		if (typedRequest.action === "openObsidianUrl") {
			const url = (typedRequest as any).url;
			if (url) {
				browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
					const currentTab = tabs[0];
					if (currentTab && currentTab.id) {
						browser.tabs.update(currentTab.id, { url: url }).then(() => {
							sendResponse({ success: true });
						}).catch((error) => {
							console.error('Error opening Obsidian URL:', error);
							sendResponse({
								success: false,
								error: error instanceof Error ? error.message : String(error)
							});
						});
					} else {
						sendResponse({
							success: false,
							error: 'No active tab found'
						});
					}
				}).catch((error) => {
					console.error('Error querying tabs:', error);
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
				return true;
			} else {
				sendResponse({
					success: false,
					error: 'Missing URL'
				});
				return true;
			}
		}

		// For other actions that use sendResponse
		if (typedRequest.action === "extractContent" ||
			typedRequest.action === "ensureContentScriptLoaded" ||
			typedRequest.action === "getHighlighterMode" ||
			typedRequest.action === "toggleHighlighterMode" ||
			typedRequest.action === "openObsidianUrl") {
			return true;
		}
	}
	return undefined;
});

browser.commands.onCommand.addListener(async (command, tab) => {
	// Some browsers (e.g. Orion) don't pass the tab parameter, so fall back to querying
	if (!tab?.id) {
		const tabs = await browser.tabs.query({active: true, currentWindow: true});
		tab = tabs[0];
	}

	if (command === 'quick_clip') {
		if (tab?.id) {
			openPopup();
			setTimeout(() => {
				browser.runtime.sendMessage({action: "triggerQuickClip"})
					.catch(error => console.error("Failed to send quick clip message:", error));
			}, 500);
		}
	}
	if (command === "toggle_highlighter" && tab?.id) {
		await toggleHighlighterMode(tab.id);
	}
	if (command === "copy_to_clipboard" && tab?.id) {
		await sendMessageToContentScript(tab.id, { action: "copyToClipboard" });
	}
	if (command === "open_editor" && tab?.id) {
		await runTripleKeyAction('edit', tab.id);
	}
	// The reading shortcut opens our reading page, the same as the Read button.
	if (command === "toggle_reader" && tab?.id) {
		await runTripleKeyAction('read', tab.id);
	}
});

const debouncedUpdateContextMenu = debounce(async (tabId: number) => {
	if (isContextMenuCreating) {
		return;
	}
	isContextMenuCreating = true;

	try {
		await browser.contextMenus.removeAll();

		let currentTabId = tabId;
		if (currentTabId === -1) {
			const tabs = await browser.tabs.query({ active: true, currentWindow: true });
			if (tabs.length > 0) {
				currentTabId = tabs[0].id!;
			}
		}

		const isHighlighterMode = getHighlighterModeForTab(currentTabId);
		const isReaderMode = getReaderModeForTab(currentTabId);

		const menuItems: {
			id: string;
			title: string;
			contexts: browser.Menus.ContextType[];
		}[] = [
				{
					id: "open-obsidian-clipper",
					title: "Save this page",
					contexts: ["page", "selection", "image", "video", "audio"]
				},
				{
					id: 'copy-markdown-to-clipboard',
					title: browser.i18n.getMessage('copyToClipboard'),
					contexts: ["page", "selection"]
				},
				{
					id: isReaderMode ? "exit-reader" : "enter-reader",
					title: isReaderMode ? browser.i18n.getMessage('disableReader') : browser.i18n.getMessage('readerOn'),
					contexts: ["page", "selection"]
				},
				{
					id: isHighlighterMode ? "exit-highlighter" : "enter-highlighter",
					title: isHighlighterMode ? browser.i18n.getMessage('disableHighlighter') : browser.i18n.getMessage('highlighterOn'),
					contexts: ["page","image", "video", "audio"]
				},
				{
					id: "highlight-selection",
					title: "Add to highlights",
					contexts: ["selection"]
				},
				{
					id: "highlight-element",
					title: "Add to highlights",
					contexts: ["image", "video", "audio"]
				},
				{
					id: 'save-selection-to-diary',
					title: browser.i18n.getMessage('saveSelectionToDiary'),
					contexts: ["selection"]
				},
				{
					id: 'open-embedded',
					title: browser.i18n.getMessage('openEmbedded'),
					contexts: ["page", "selection"]
				}
			];

		const browserType = await detectBrowser();
		if (browserType === 'chrome') {
			menuItems.push({
				id: 'open-side-panel',
				title: browser.i18n.getMessage('openSidePanel'),
				contexts: ["page", "selection"]
			});
		}

		for (const item of menuItems) {
			await browser.contextMenus.create(item);
		}
	} catch (error) {
		console.error('Error updating context menu:', error);
	} finally {
		isContextMenuCreating = false;
	}
}, 100); // 100ms debounce time

browser.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === "open-obsidian-clipper") {
		openPopup();
	} else if (info.menuItemId === "enter-highlighter" && tab && tab.id) {
		await setHighlighterMode(tab.id, true);
	} else if (info.menuItemId === "exit-highlighter" && tab && tab.id) {
		await setHighlighterMode(tab.id, false);
	} else if (info.menuItemId === "highlight-selection" && tab && tab.id) {
		await highlightSelection(tab.id, info);
	} else if (info.menuItemId === "highlight-element" && tab && tab.id) {
		await highlightElement(tab.id, info);
	} else if ((info.menuItemId === "enter-reader" || info.menuItemId === "exit-reader") && tab && tab.id) {
		await toggleReaderModeInTab(tab.id);
	} else if (info.menuItemId === 'save-selection-to-diary' && tab && tab.id) {
		await openNoteCard(tab.id, info.selectionText);
	} else if (info.menuItemId === 'open-embedded' && tab && tab.id) {
		await sendMessageToContentScript(tab.id, { action: "toggle-iframe" });
	} else if (info.menuItemId === 'open-side-panel' && tab && tab.id && tab.windowId) {
		chrome.sidePanel.open({ tabId: tab.id });
		sidePanelOpenWindows.add(tab.windowId);
		await ensureContentScriptLoadedInBackground(tab.id);
	} else if (info.menuItemId === 'copy-markdown-to-clipboard' && tab && tab.id) {
		await sendMessageToContentScript(tab.id, { action: "copyMarkdownToClipboard" });
	}
});

// Content scripts declared in the manifest only reach pages loaded afterwards; give open tabs the shortcut listener too.
async function injectTripleKeyIntoOpenTabs(): Promise<void> {
	if (!browser.scripting) return;
	const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
	await Promise.all(tabs.filter(tab => tab.id !== undefined).map(tab =>
		browser.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, files: ['triple-key.js'] }).catch(() => { /* restricted page */ })
	));
}

browser.runtime.onInstalled.addListener(() => {
	debouncedUpdateContextMenu(-1); // Use a dummy tabId for initial creation
	void injectTripleKeyIntoOpenTabs();
});

async function isSidePanelOpen(windowId: number): Promise<boolean> {
	return sidePanelOpenWindows.has(windowId);
}

async function setupTabListeners() {
	const browserType = await detectBrowser();
	if (['chrome', 'brave', 'edge'].includes(browserType)) {
		browser.tabs.onActivated.addListener(handleTabChange);
		browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
			if (changeInfo.status === 'complete') {
				handleTabChange({ tabId, windowId: tab.windowId });
			}
		});
	}
}

const debouncedPaintHighlights = debounce(async (tabId: number) => {
	if (!getHighlighterModeForTab(tabId)) {
		await setHighlighterMode(tabId, false);
	}
	await paintHighlights(tabId);
}, 250);

async function handleTabChange(activeInfo: { tabId: number; windowId?: number }) {
	if (activeInfo.windowId && await isSidePanelOpen(activeInfo.windowId)) {
		updateCurrentActiveTab(activeInfo.windowId);
		await debouncedPaintHighlights(activeInfo.tabId);
	}
}

async function paintHighlights(tabId: number) {
	try {
		const tab = await browser.tabs.get(tabId);
		if (!tab || !tab.url || !isValidUrl(tab.url) || isBlankPage(tab.url)) {
			return;
		}

		await sendMessageToContentScript(tabId, { action: "paintHighlights" });

	} catch (error) {
		console.error('Error painting highlights:', error);
	}
}

function setHighlighterMode(tabId: number, activate: boolean): Promise<void> {
	return queueHighlighterModeChange(tabId, () => applyHighlighterMode(tabId, activate));
}

async function applyHighlighterMode(tabId: number, activate: boolean) {
	try {
		// First, check if the tab exists
		const tab = await browser.tabs.get(tabId);
		if (!tab || !tab.url) {
			return;
		}

		// Check if the URL is valid and not a blank page
		if (!isValidUrl(tab.url) || isBlankPage(tab.url)) {
			return;
		}

		highlighterModeState[tabId] = activate;
		await sendMessageToContentScript(tabId, { action: "setHighlighterMode", isActive: activate });
		debouncedUpdateContextMenu(tabId);
		await sendMessageToPopup(tabId, { action: "updatePopupHighlighterUI", isActive: activate });

	} catch (error) {
		console.error('Error setting highlighter mode:', error);
		// If there's an error, assume highlighter mode should be off
		highlighterModeState[tabId] = false;
		debouncedUpdateContextMenu(tabId);
		await sendMessageToPopup(tabId, { action: "updatePopupHighlighterUI", isActive: false });
	}
}

function toggleHighlighterMode(tabId: number): Promise<boolean> {
	return queueHighlighterModeChange(tabId, () => applyHighlighterToggle(tabId));
}

async function applyHighlighterToggle(tabId: number): Promise<boolean> {
	try {
		const currentMode = getHighlighterModeForTab(tabId);
		const newMode = !currentMode;
		await sendMessageToContentScript(tabId, { action: "setHighlighterMode", isActive: newMode });
		highlighterModeState[tabId] = newMode;
		debouncedUpdateContextMenu(tabId);
		await sendMessageToPopup(tabId, { action: "updatePopupHighlighterUI", isActive: newMode });
		return newMode;
	} catch (error) {
		console.error('Error toggling highlighter mode:', error);
		throw error;
	}
}

async function highlightSelection(tabId: number, info: browser.Menus.OnClickData) {
	const highlightData: Partial<TextHighlightData> = {
		id: Date.now().toString(),
		type: 'text',
		content: info.selectionText || '',
	};

	await sendMessageToContentScript(tabId, {
		action: "highlightSelection", 
		isActive: true,
		highlightData,
	});
	highlighterModeState[tabId] = true;
	hasHighlights = true;
	debouncedUpdateContextMenu(tabId);
}

async function highlightElement(tabId: number, info: browser.Menus.OnClickData) {
	await sendMessageToContentScript(tabId, {
		action: "highlightElement", 
		isActive: true,
		targetElementInfo: {
			mediaType: info.mediaType === 'image' ? 'img' : info.mediaType,
			srcUrl: info.srcUrl,
			pageUrl: info.pageUrl
		}
	});
	highlighterModeState[tabId] = true;
	hasHighlights = true;
	debouncedUpdateContextMenu(tabId);
}

async function toggleReaderModeInTab(tabId: number): Promise<{ success?: boolean; isActive?: boolean }> {
	await ensureContentScriptLoadedInBackground(tabId);
	await injectReaderScript(tabId);
	const response = await browser.tabs.sendMessage(tabId, { action: "toggleReaderMode" }) as { success?: boolean; isActive?: boolean };
	if (response?.success) {
		readerModeState[tabId] = response.isActive ?? false;
		debouncedUpdateContextMenu(tabId);
	}
	return response;
}

async function injectReaderScript(tabId: number) {
	try {
		await browser.scripting.insertCSS({
			target: { tabId },
			files: ['reader.css']
		});
		await browser.scripting.insertCSS({
			target: { tabId },
			files: ['highlighter.css']
		}).catch(() => {});

		// Inject scripts in sequence for all browsers
		await browser.scripting.executeScript({
			target: { tabId },
			files: ['browser-polyfill.min.js']
		});
		await browser.scripting.executeScript({
			target: { tabId },
			files: ['reader-script.js']
		});

		return true;
	} catch (error) {
		console.error('Error injecting reader script:', error);
		return false;
	}
}

// When set to 'reader' or 'embedded', clear the popup so action.onClicked fires
// instead, handling the action directly without briefly opening the popup.
// Two ways to answer a click on the toolbar button: the popup, or straight into our reading page. (The old in-page panel option
// is gone; a saved 'embedded' counts as the popup.)
function parseOpenBehavior(raw: string | undefined): Settings['openBehavior'] {
	return raw === 'reader' ? 'reader' : 'popup';
}

async function updateActionPopup(openBehavior?: Settings['openBehavior']): Promise<void> {
	if (!openBehavior) {
		const data = await browser.storage.sync.get('general_settings');
		openBehavior = parseOpenBehavior((data.general_settings as Record<string, string>)?.openBehavior);
	}
	currentOpenBehavior = openBehavior;
	if (openBehavior === 'reader') {
		await browser.action.setPopup({ popup: '' });
	} else {
		await browser.action.setPopup({ popup: 'popup.html' });
	}
}

let currentOpenBehavior: Settings['openBehavior'] = 'popup';

// The note card lives in the page itself: ask a copy that is already there, otherwise inject it (it opens on load).
async function openNoteCard(tabId: number, quote?: string): Promise<void> {
	try { if (await browser.tabs.sendMessage(tabId, { action: 'qiaomuOpenNote', quote }, { frameId: 0 })) return; } catch { /* not injected yet */ }
	try {
		if (quote) await browser.scripting.executeScript({ target: { tabId }, func: (text: string) => { (window as unknown as { qiaomuNoteQuote?: string }).qiaomuNoteQuote = text; }, args: [quote] });
		await browser.scripting.insertCSS({ target: { tabId }, files: ['note-card.css'] });
		await browser.scripting.executeScript({ target: { tabId }, files: ['note-card.js'] });
	} catch { /* restricted page */ }
}

// Supported media detail pages share the native study player. A feed adapter supplies the currently playing item address.
async function webStudyPath(url: string, tabId: number): Promise<string | null> {
	const site = siteOf(url); if (!site || site.builtin || !isSiteOn(await loadStudySites(), site.id)) return null;
	let post = webMediaAddress(url);
	try { const source = await browser.tabs.sendMessage(tabId, { action: 'qiaomuWebMediaSource' }) as { url?: unknown } | undefined; if (typeof source?.url === 'string' && siteOf(source.url)?.id === site.id) post = webMediaAddress(source.url); } catch { /* adapter not loaded */ }
	if (!post) return null;
	try {
		const [result] = await browser.scripting.executeScript({ target: { tabId }, func: () => Boolean(document.querySelector('video, audio, iframe[src*="player.vimeo.com"], iframe[src*="player.twitch.tv"], iframe[src*="dailymotion.com"], [data-testid="videoPlayer"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"]')) });
		return result?.result || isMediaItemAddress(post) ? `reader.html?study=web&url=${encodeURIComponent(post)}&sourceTab=${tabId}` : null;
	} catch { return null; }
}

// The triple-press commands open the clipper, which runs read / edit / clip once the clip is ready.
async function runTripleKeyAction(action: string, tabId: number): Promise<void> {
	if (action === 'note') { await openNoteCard(tabId); return; }
	if (action !== 'read' && action !== 'edit' && action !== 'clip') return;
	if (action === 'read') {
		const tab = await browser.tabs.get(tabId);
		const path = videoStudyPath(tab.url || '', tabId, tab.title || '') || audioStudyPath(tab.url || '', tab.title || '') || await webStudyPath(tab.url || '', tabId);
		if (path) {
			// Open the player immediately; subtitle extraction belongs to the reader.
			await browser.tabs.create({ url: browser.runtime.getURL(path), openerTabId: tabId });
			return;
		}
	}
	// Reading and editing need no window of their own: an invisible copy of the clipper in the page does the work and opens our page.
	// Where the page cannot host one (browser pages, a page that was open before an update), fall back to the popup.
	const windowless = action === 'read' || action === 'edit';
	if (windowless) {
		await browser.storage.local.set({ qiaomuPendingAction: { action, at: Date.now(), hidden: true } });
		try { const answer = await sendMessageToContentScript(tabId, { action: 'run-hidden-iframe' }) as { success?: boolean } | undefined; if (answer?.success) return; } catch { /* no content script here */ }
	}
	await browser.storage.local.set({ qiaomuPendingAction: { action, at: Date.now() } });
	try {
		await openPopup();
	} catch {
		// Popups can't always be opened without a toolbar click; the embedded panel runs the same code.
		await sendMessageToContentScript(tabId, { action: "toggle-iframe" });
	}
}

// With the toolbar button set to reading mode the popup is switched off; turn it on just long enough to open it, because the
// popup is what builds the clip that the reading page shows.
async function openPopup(): Promise<void> {
	const readerMode = currentOpenBehavior === 'reader';
	if (readerMode) await browser.action.setPopup({ popup: 'popup.html' });
	try { await browser.action.openPopup(); }
	finally { if (readerMode) await browser.action.setPopup({ popup: '' }); }
}

browser.action.onClicked.addListener(async (tab) => {
	if (!tab?.id || !tab.url || !isValidUrl(tab.url) || isBlankPage(tab.url)) return;

	// Reading mode here is our own reading page (video and podcast pages go to the study player), not the in-page reader.
	if (currentOpenBehavior === 'reader') await runTripleKeyAction('read', tab.id);
});

browser.storage.onChanged.addListener((changes, area) => {
	if (area === 'sync' && changes.general_settings) {
		updateActionPopup(parseOpenBehavior((changes.general_settings.newValue as Record<string, string>)?.openBehavior));
	}
});

// Initialize the extension
initialize().catch(error => {
	console.error('Failed to initialize background script:', error);
});

// Only our isolated content scripts may start a study conversation. Provider
// identity comes from saved settings, never a caller-supplied URL or API key.
browser.runtime.onConnect.addListener(port => {
	if (port.name !== 'qiaomu-study-chat') return;
	if (port.sender?.id !== browser.runtime.id) { port.disconnect(); return; }
	const controller = new AbortController();
	port.onDisconnect.addListener(() => controller.abort());
	let started = false;
	port.onMessage.addListener(async raw => {
		const request = raw as { modelId?: string; system?: string; messages?: any[] };
		if (started) return;
		started = true;
		const send = (message: unknown) => { if (!controller.signal.aborted) port.postMessage(message); };
		try {
			await loadSettings();
			const model = enabledChatModels().find(item => item.id === request.modelId);
			if (!model || typeof request.system !== 'string' || !Array.isArray(request.messages)
				|| request.messages.some((turn: any) => !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')) throw new Error('无效的 AI 对话请求');
			await streamChat({ model, system: request.system, messages: request.messages, signal: controller.signal, onDelta: delta => send({ delta }) });
			send({ done: true });
		} catch (error) { send({ error: error instanceof Error ? error.message : 'AI 请求失败' }); }
	});
});

// Bilibili only returns subtitle tracks to a signed-in viewer, and its cookies are not reliably sent from the
// service worker. Run the request inside the viewer's own Bilibili tab, where the session and site context are real.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; sourceTabId?: number; url?: string; sourceUrl?: string };
	if (request?.action !== 'qiaomuBilibiliTabFetch') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html'))
		|| !Number.isInteger(request.sourceTabId) || !request.url || !request.sourceUrl) return Promise.resolve({ error: '无效的请求' });
	let target: URL;
	try { target = new URL(request.url); } catch { return Promise.resolve({ error: '无效的请求' }); }
	if (target.protocol !== 'https:' || !/(^|\.)(bilibili\.com|hdslb\.com)$/.test(target.hostname)) return Promise.resolve({ error: '只允许访问 B 站域名' });
	return (async () => {
		try {
			const tab = await browser.tabs.get(request.sourceTabId!);
			if (!tab.url || videoKey(tab.url) !== videoKey(request.sourceUrl!)) return { error: '原视频页面已切换' };
			const results = await browser.scripting.executeScript({
				target: { tabId: request.sourceTabId! },
				func: async (href: string) => {
					const response = await fetch(href, { credentials: 'include', headers: { Accept: 'application/json' } });
					return { ok: response.ok, status: response.status, text: await response.text() };
				},
				args: [target.href],
			});
			return results[0]?.result || { error: '原视频页面没有返回结果' };
		} catch { return { error: '原视频页面不可用' }; }
	})();
});

// Seek the YouTube player through its own API. The player object lives in the page's JavaScript world, which a content
// script cannot reach, so run a tiny function there. Only the sender's own tab, only a number, only YouTube pages.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; seconds?: number };
	if (request?.action !== 'qiaomuSeek') return;
	const tabId = sender.tab?.id, seconds = request.seconds;
	if (sender.id !== browser.runtime.id || tabId === undefined || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || !/^https:\/\/www\.youtube\.com\//.test(sender.tab?.url || '')) return Promise.resolve({ ok: false });
	return browser.scripting.executeScript({
		target: { tabId }, world: 'MAIN',
		func: (to: number) => { const player = document.getElementById('movie_player') as unknown as { seekTo?: (s: number, ahead: boolean) => void; playVideo?: () => void } | null; if (!player?.seekTo) return false; player.seekTo(to, true); player.playVideo?.(); return true; },
		args: [seconds],
	}).then(results => ({ ok: results[0]?.result === true })).catch(() => ({ ok: false }));
});

// Fast route for study mode: the YouTube tab already prefetched the transcript (or reads it from the panel).
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; sourceTabId?: number; url?: string; language?: string };
	if (request?.action !== 'qiaomuStudyTranscript') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html'))
		|| !Number.isInteger(request.sourceTabId) || !request.url || !videoKey(request.url)) return Promise.resolve({ error: '无效的视频来源' });
	return (async () => {
		try {
			const tab = await browser.tabs.get(request.sourceTabId!);
			if (!tab.url || videoKey(tab.url) !== videoKey(request.url!)) return { error: '原视频页面已切换，请重新打开学习模式' };
			const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('原页面读取字幕超时')), 26000));
			const answer = await Promise.race([browser.tabs.sendMessage(request.sourceTabId!, { action: 'qiaomuTranscript', ...(typeof request.language === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(request.language) ? { language: request.language } : {}) }), timeout]) as { html?: string; count?: number; languages?: Array<{id:string;label:string}>; selected?: string } | undefined;
			return { html: answer?.html || '', count: answer?.count || 0, languages: answer?.languages, selected: answer?.selected };
		} catch (error) { return { error: error instanceof Error ? error.message : '原页面不可用' }; }
	})();
});

// Extract inside the viewer's own video tab, as the regular clipper does. YouTube answers a page with its cookies
// and origin, and Defuddle can read or open the transcript panel in the live DOM; a copy of the HTML in the
// extension page can do neither, which is why subtitles were often missing there.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; sourceTabId?: number; url?: string };
	if (request?.action !== 'qiaomuStudyLiveExtract') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html'))
		|| !Number.isInteger(request.sourceTabId) || !request.url || !videoKey(request.url)) return Promise.resolve({ error: '无效的视频来源' });
	return (async () => {
		try {
			const tab = await browser.tabs.get(request.sourceTabId!);
			if (!tab.url || videoKey(tab.url) !== videoKey(request.url!)) return { error: '原视频页面已切换，请重新打开学习模式' };
			const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('原页面提取超时')), 28000));
			// Open the transcript panel first. Once YouTube has rendered the lines, Defuddle reads them straight from
			// the page (no network, no timeouts), so the full extraction below is fast instead of racing slow fetches.
			let domHtml = '';
			if (videoKey(request.url!)?.startsWith('youtube:')) {
				const dom = await Promise.race([sendMessageToContentScript(request.sourceTabId!, { action: 'qiaomuReadTranscriptDom' }), timeout]).catch(() => undefined) as { html?: string } | undefined;
				domHtml = dom?.html || '';
			}
			const page = await Promise.race([sendMessageToContentScript(request.sourceTabId!, { action: 'getPageContent' }), timeout]) as Record<string, any> | undefined;
			if (!page || typeof page.content !== 'string') return { error: '原页面没有返回内容' };
			if (domHtml && !/class="[^"]*\btranscript\b/.test(page.content)) page.content += domHtml;
			// Everything the study page needs, without the full page HTML.
			const { content, title, author, description, favicon, image, published, site, wordCount, language, schemaOrgData, extractedContent, metaTags } = page;
			return { content, title, author, description, favicon, image, published, site, wordCount, language, schemaOrgData, extractedContent, metaTags };
		} catch (error) { return { error: error instanceof Error ? error.message : '原页面不可用' }; }
	})();
});

// Obtain a fresh source snapshot on every subtitle attempt. The original tab
// remains available while YouTube is still loading its transcript UI.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; sourceTabId?: number; url?: string };
	if (request?.action !== 'qiaomuYouTubeStudySource') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html'))
		|| !Number.isInteger(request.sourceTabId) || !request.url || !videoKey(request.url)) return Promise.resolve({ error: '无效的视频来源' });
	return (async () => {
		try {
			const tab = await browser.tabs.get(request.sourceTabId!);
			if (!tab.url || videoKey(tab.url) !== videoKey(request.url!)) return { error: '原视频页面已切换，请重新打开学习模式' };
			const results = await browser.scripting.executeScript({ target: { tabId: request.sourceTabId! }, func: () => ({ html: document.documentElement.outerHTML, title: document.title }) });
			return results[0]?.result || { error: '无法读取原视频页面' };
		} catch { return { error: '原视频页面不可用，将从视频链接获取字幕' }; }
	})();
});

// The study reader asks for the video files TikTok's own page has loaded, so it can play the video next to the transcript.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; url?: string; sourceTabId?: number };
	if (request?.action !== 'qiaomuTikTokMedia') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html')) || typeof request.url !== 'string') return Promise.resolve(null);
	const wanted = tiktokVideoPath(request.url);
	if (!wanted) return Promise.resolve(null);
	return (async () => {
		let tab: { id?: number; url?: string } | undefined;
		if (Number.isInteger(request.sourceTabId) && request.sourceTabId! >= 0) { try { tab = { ...(await browser.tabs.get(request.sourceTabId!)), id: request.sourceTabId }; } catch { /* the original tab was closed */ } }
		if (!tab?.url || !tabMayLendTikTokMedia(tab.url, wanted)) tab = ((await browser.tabs.query({ url: 'https://*.tiktok.com/*' })) || []).find(t => tiktokVideoPath(t.url || '') === wanted);
		if (tab?.id === undefined) return null;
		const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: snapshotTikTokPlayer });
		const snapshot = result?.result as ReturnType<typeof snapshotTikTokPlayer> | undefined;
		// A video page must be this item; a feed page names none, so the caller checks the length.
		if (!snapshot?.url || (tiktokVideoPath(snapshot.url) && tiktokVideoPath(snapshot.url) !== wanted)) return null;
		return { seconds: Number.isFinite(snapshot.seconds) ? snapshot.seconds : null, candidates: snapshot.candidates.filter(isTikTokMedia) };
	})().catch(() => null);
});

// Only the study reader can ask for a media address from its original page.
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
	const request = raw as { action?: string; url?: string; sourceTabId?: number };
	if (request?.action !== 'qiaomuWebStudySource') return;
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('reader.html')) || typeof request.url !== 'string') return Promise.resolve(null);
	return getWebPageMedia(request.url, request.sourceTabId, browser.tabs, async tabId => {
		const [result] = await browser.scripting.executeScript({ target: { tabId }, func: snapshotDouyinPlayer });
		const snapshot = result?.result as ReturnType<typeof snapshotDouyinPlayer> | undefined;
		if (snapshot?.observed && snapshot.info) {
			// Several preloaded items can sit in the page; only the one as long as the playing video is this item.
			for (const candidate of snapshot.candidates?.length ? snapshot.candidates : [snapshot.info.mediaUrl!]) {
				const [checked] = await browser.scripting.executeScript({ target: { tabId }, func: validateDouyinTracks, args: [snapshot.url, candidate, candidate, snapshot.info.seconds!] });
				if (checked?.result) return { ...snapshot, info: { ...snapshot.info, mediaUrl: candidate } };
			}
			return;
		}
		if (snapshot?.info?.audioUrl) {
			const info = snapshot.info;
			const [checked] = await browser.scripting.executeScript({ target: { tabId }, func: validateDouyinTracks, args: [snapshot.url, info.mediaUrl!, info.audioUrl!, info.seconds!] });
			if (!checked?.result) return;
		}
		return snapshot;
	}).then(info => info || null);
});
