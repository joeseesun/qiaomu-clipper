import browser from '../utils/browser-polyfill';
import { BridgeClient, bytesToBase64 } from './client';
import type { BridgeAsset, BridgeStatus } from './protocol';

// The page-side scripts (X, Zhihu, Xiaohongshu) all speak the same small port protocol:
//   in : ping | image {source,mime,fileName,bytes,base64} | run {...} | cancel
//   out: pong {route} | progress {text} | done {summary,message} | cancelled | error {error}

export async function waitForTab(tabId: number, timeoutMs = 30000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const tab = await browser.tabs.get(tabId);
		if (tab.status === 'complete') return;
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	throw new Error('页面加载太慢，请检查网络后重试');
}

/** Removes `#qp=…` from the address bar. Run only after the token has been exchanged, so it is already useless. */
export async function scrubFragment(tabId: number): Promise<void> {
	try {
		await browser.scripting.executeScript({ target: { tabId }, func: () => { history.replaceState(null, '', location.pathname + location.search); } });
	} catch { /* the page may still be loading; the token is spent either way */ }
}

export async function connectToPage(tabId: number, portName: string, routeMessage: string): Promise<ReturnType<typeof browser.tabs.connect>> {
	for (let attempt = 0; attempt < 12; attempt++) {
		const port = browser.tabs.connect(tabId, { name: portName });
		const alive = await new Promise<{ route?: boolean } | null>(resolve => {
			const timer = setTimeout(() => resolve(null), 700);
			port.onMessage.addListener((message: any) => { if (message?.type === 'pong') { clearTimeout(timer); resolve(message); } });
			port.onDisconnect.addListener(() => { clearTimeout(timer); resolve(null); });
			try { port.postMessage({ type: 'ping' }); } catch { resolve(null); }
		});
		if (alive) {
			if (!alive.route) { port.disconnect(); throw new Error(routeMessage); }
			return port;
		}
		port.disconnect();
		await new Promise(resolve => setTimeout(resolve, 400));
	}
	throw new Error('连不上网页，请刷新页面后重试');
}

export interface RelayResult { ok: boolean; cancelled?: boolean; message?: string; summary?: { url?: string; remoteId?: string } & Record<string, unknown> }

/** Passes the page's progress on to Obsidian and the stop request from Obsidian to the page, until the page finishes. */
export function relayPort(port: ReturnType<typeof browser.tabs.connect>, client: BridgeClient, send: (post: (message: unknown) => void) => Promise<void>, describe: (text: string) => string = text => text): Promise<RelayResult> {
	return new Promise(resolve => {
		let settled = false;
		const beat = setInterval(() => {
			void client.status({ state: 'running' }).then(() => { if (client.cancelled && !settled) { try { port.postMessage({ type: 'cancel' }); } catch { /* gone */ } } });
		}, 3000);
		const finish = (result: RelayResult) => { if (settled) return; settled = true; clearInterval(beat); resolve(result); };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'progress') void client.status({ state: 'running', text: describe(String(message.text || '')) });
			else if (message?.type === 'done') finish({ ok: true, message: message.message, summary: message.summary });
			else if (message?.type === 'cancelled') finish({ ok: false, cancelled: true });
			else if (message?.type === 'error') finish({ ok: false, message: message.error });
		});
		port.onDisconnect.addListener(() => finish({ ok: false, message: '和网页的连接断开了，可能是页面被刷新或关闭' }));
		send(message => {
			if (client.cancelled) throw Object.assign(new Error('已停止'), { stopped: true });
			if (settled) throw new Error('和网页的连接已结束');
			port.postMessage(message);
		}).catch(error => finish((error as { stopped?: boolean }).stopped
			? { ok: false, cancelled: true }
			: { ok: false, message: (error as Error).message || String(error) }));
	});
}

export async function sendAssets(client: BridgeClient, assets: BridgeAsset[], post: (message: unknown) => void, source: (asset: BridgeAsset) => string, report: (text: string) => void): Promise<void> {
	for (const [index, asset] of assets.entries()) {
		if (client.cancelled) throw Object.assign(new Error('已停止'), { stopped: true });
		report(`正在取图片 ${index + 1}/${assets.length}…`);
		const data = await client.asset(asset);
		if (client.cancelled) throw Object.assign(new Error('已停止'), { stopped: true });
		post({ type: 'image', source: source(asset), mime: asset.mime, fileName: asset.name, bytes: data.byteLength, base64: bytesToBase64(data) });
	}
}

export function finalStatus(result: RelayResult, doneText: string, fallbackError: string): BridgeStatus {
	if (result.ok) return { state: 'done', text: result.message ?? doneText, url: result.summary?.url, remoteId: result.summary?.remoteId };
	if (result.cancelled) return { state: 'cancelled', text: '已停止' };
	return { state: 'error', error: { message: result.message ?? fallbackError } };
}
