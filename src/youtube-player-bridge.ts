// Runs in YouTube's own page world (manifest "world": "MAIN"), at document start. The extension's normal content scripts cannot see
// the player object or the requests the page makes; this small bridge shows them what they need, over window.postMessage:
//   - the player's caption tracks, and the addresses it holds for them (these carry the "pot" proof that YouTube asks for),
//   - the address of any caption request the player has made itself (it also carries that proof),
//   - turning the player's captions on or off, which makes the player ask for them.
// It reads, and clicks the player's own captions button; it sends nothing anywhere.
import { BRIDGE_CHANNEL, type BridgeRequest, type BridgeSnapshot, type BridgeTrack } from './utils/youtube-player-bridge-protocol';

interface Player extends HTMLElement {
	getPlayerResponse?: () => any;
	getAudioTrack?: () => any;
	getPlayerState?: () => number;
	getWebPlayerContextConfig?: () => any;
	toggleSubtitles?: () => void;
}

const seen = new Map<string, string>();
const remember = (address: string) => {
	try {
		const url = new URL(address, location.href);
		if (url.pathname !== '/api/timedtext') return;
		const video = url.searchParams.get('v');
		if (video && url.searchParams.get('pot')) seen.set(video, url.toString());
	} catch { /* not an address */ }
};

function watchRequests(): void {
	const open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, address: string | URL, ...rest: unknown[]) {
		try { remember(String(address)); } catch { /* never get in the page's way */ }
		return (open as (...args: unknown[]) => void).call(this, method, address, ...rest);
	} as typeof XMLHttpRequest.prototype.open;
	const original = window.fetch;
	window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
		try { remember(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url); } catch { /* ignore */ }
		return original.call(window, input, init);
	};
}

const player = (): Player | null => document.querySelector<Player>('#movie_player') ?? document.querySelector<Player>('.html5-video-player');
const captionsButton = () => document.querySelector<HTMLElement>('.ytp-subtitles-button');
const captionsOn = () => captionsButton()?.getAttribute('aria-pressed') === 'true';

const track = (item: any): BridgeTrack | undefined => typeof item?.languageCode === 'string' && (typeof item.baseUrl === 'string' || typeof item.url === 'string')
	? { url: String(item.baseUrl ?? item.url), languageCode: item.languageCode, kind: typeof item.kind === 'string' ? item.kind : undefined, vssId: typeof item.vssId === 'string' ? item.vssId : undefined, name: nameOf(item.name) }
	: undefined;
const nameOf = (name: any): string | undefined => typeof name?.simpleText === 'string' ? name.simpleText : Array.isArray(name?.runs) ? name.runs.map((run: { text?: string }) => run.text || '').join('') : undefined;
const list = (items: unknown): BridgeTrack[] => (Array.isArray(items) ? items : []).map(track).filter((item): item is BridgeTrack => Boolean(item));

function snapshot(): BridgeSnapshot {
	const p = player(), response = p?.getPlayerResponse?.(), video = response?.videoDetails?.videoId;
	const device = (window as unknown as { ytcfg?: { get?: (key: string) => string | undefined } }).ytcfg?.get?.('DEVICE') ?? null;
	return {
		videoId: typeof video === 'string' ? video : null,
		tracks: list(response?.captions?.playerCaptionsTracklistRenderer?.captionTracks),
		audioTracks: list(p?.getAudioTrack?.()?.captionTracks),
		requestUrl: video ? seen.get(video) ?? null : null,
		state: p?.getPlayerState?.() ?? -1,
		device,
		clientVersion: p?.getWebPlayerContextConfig?.()?.innertubeContextClientVersion ?? null,
		captionsOn: captionsOn(),
	};
}

function setCaptions(on: boolean): boolean {
	if (captionsOn() === on) return false;
	const p = player(), button = captionsButton();
	if (!button) return false;
	if (p?.toggleSubtitles) p.toggleSubtitles(); else button.click();
	return true;
}

if (!(window as unknown as { __qiaomuYtBridge?: boolean }).__qiaomuYtBridge) {
	(window as unknown as { __qiaomuYtBridge?: boolean }).__qiaomuYtBridge = true;
	watchRequests();
	window.addEventListener('message', event => {
		if (event.source !== window || event.origin !== location.origin) return;
		const request = event.data as BridgeRequest | undefined;
		if (!request || request.channel !== BRIDGE_CHANNEL || request.dir !== 'req' || typeof request.id !== 'string') return;
		let data: unknown;
		try { data = request.type === 'snapshot' ? snapshot() : request.type === 'captions' ? { changed: setCaptions(request.on === true) } : undefined; } catch { data = undefined; }
		window.postMessage({ channel: BRIDGE_CHANNEL, dir: 'res', id: request.id, data }, location.origin);
	});
}
