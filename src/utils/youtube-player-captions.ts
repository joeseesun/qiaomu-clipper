import type { PanelSegment } from './youtube-panel-actions';
import { chooseTrack } from './subtitle-language';
import { fetchCaptionResult, parseCaptions, trackInfos, type CaptionResult, type CaptionTrack, type YouTubeTrack } from './youtube-captions';
import { BRIDGE_CHANNEL, type BridgeSnapshot, type BridgeTrack } from './youtube-player-bridge-protocol';

// YouTube no longer hands a caption file to a script that just asks: the file's address must carry a proof ("pot") that the page's own
// player holds. So the captions are read the way the player reads them. A small bridge in the page world (youtube-player-bridge.ts) lends us
// the player's track list and the addresses it holds; we add the usual parameters and download the file with the viewer's own cookies.
// If the player has no proof yet, its captions are switched on for a moment: the player then asks for them, and we pick up the proof from
// that request. This route comes first; the older routes (below) stay as the fallback.

type Ask = <T>(message: { type: 'snapshot' } | { type: 'captions'; on: boolean }, timeoutMs?: number) => Promise<T | undefined>;
export interface PlayerIo { ask: Ask; fetch: typeof fetch; sleep: (ms: number) => Promise<void> }

const defaultAsk: Ask = (message, timeoutMs = 1500) => new Promise(resolve => {
	const id = Math.random().toString(36).slice(2);
	const done = (value: unknown) => { window.removeEventListener('message', onMessage); clearTimeout(timer); resolve(value as never); };
	const onMessage = (event: MessageEvent) => {
		const data = event.data as { channel?: string; dir?: string; id?: string; data?: unknown } | undefined;
		if (event.source === window && data?.channel === BRIDGE_CHANNEL && data.dir === 'res' && data.id === id) done(data.data);
	};
	const timer = setTimeout(() => done(undefined), timeoutMs);
	window.addEventListener('message', onMessage);
	window.postMessage({ channel: BRIDGE_CHANNEL, dir: 'req', id, ...message }, location.origin);
});
export const defaultIo = (): PlayerIo => ({ ask: defaultAsk, fetch: (...args) => fetch(...args), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) });

const FIXED = { fmt: 'json3', c: 'WEB', cplayer: 'UNIPLAYER' } as const;
const DEVICE_KEYS = ['cbrand', 'cbr', 'cbrver', 'cos', 'cosver', 'cplatform'] as const;

// Only a caption address on YouTube itself is ever fetched with the viewer's cookies: the bridge's answer comes from a page we do not control.
export function isCaptionAddress(address: string): boolean {
	try { const url = new URL(address); return url.protocol === 'https:' && /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/api/timedtext'; } catch { return false; }
}

export interface Proof { pot: string | null; potc: string | null }
const proofOf = (address: string | undefined): Proof => {
	try { const url = new URL(address || ''); return { pot: url.searchParams.get('pot'), potc: url.searchParams.get('potc') }; } catch { return { pot: null, potc: null }; }
};

// The proof the player holds for this track: from its own address for the track, else for the same language, else from any caption request it made.
export function proofFor(track: Pick<CaptionTrack, 'languageCode' | 'kind' | 'vssId'>, snapshot: Pick<BridgeSnapshot, 'audioTracks' | 'requestUrl'>): Proof {
	const own = snapshot.audioTracks.find(item => track.vssId && item.vssId === track.vssId)
		?? snapshot.audioTracks.find(item => item.languageCode === track.languageCode && (item.kind ?? '') === (track.kind ?? ''))
		?? snapshot.audioTracks.find(item => item.languageCode === track.languageCode);
	const found = proofOf(own?.url);
	return found.pot ? found : proofOf(snapshot.requestUrl ?? undefined);
}

export function captionAddress(track: Pick<CaptionTrack, 'baseUrl'>, snapshot: Pick<BridgeSnapshot, 'device' | 'clientVersion'>, proof: Proof): string {
	const url = new URL(track.baseUrl, 'https://www.youtube.com');
	for (const [key, value] of Object.entries(FIXED)) url.searchParams.set(key, value);
	if (snapshot.device) { const device = new URLSearchParams(snapshot.device); for (const key of DEVICE_KEYS) { const value = device.get(key); if (value) url.searchParams.set(key, value); } }
	if (snapshot.clientVersion) url.searchParams.set('cver', snapshot.clientVersion);
	if (proof.pot) url.searchParams.set('pot', proof.pot);
	if (proof.potc) url.searchParams.set('potc', proof.potc);
	return url.toString();
}

const asTrack = (item: BridgeTrack): CaptionTrack => ({ baseUrl: item.url, languageCode: item.languageCode, kind: item.kind, vssId: item.vssId, name: item.name ? { simpleText: item.name } : undefined });

// The player takes a moment to load after the page opens: wait until it speaks about this video.
async function settle(videoId: string, io: PlayerIo): Promise<BridgeSnapshot | undefined> {
	for (let attempt = 0; attempt < 14; attempt++) {
		const snapshot = await io.ask<BridgeSnapshot>({ type: 'snapshot' }, 1200);
		if (snapshot && snapshot.videoId === videoId && snapshot.tracks.length) return snapshot;
		if (snapshot && snapshot.videoId === videoId && attempt >= 5) return snapshot;   // the video has no tracks
		await io.sleep(300);
	}
	return undefined;
}

// The video's tracks as the player lists them, and a way to download any one of them.
export interface PlayerCaptions { tracks: YouTubeTrack[]; chosen: YouTubeTrack; fetchTrack: (track: CaptionTrack) => Promise<PanelSegment[]> }
export async function openPlayerCaptions(videoId: string, preferred?: string, io: PlayerIo = defaultIo()): Promise<PlayerCaptions | undefined> {
	let snapshot = await settle(videoId, io);
	if (!snapshot || !snapshot.tracks.length) return undefined;
	const infos = trackInfos(snapshot.tracks.map(asTrack), true), chosen = chooseTrack(infos, preferred);
	if (!chosen) return undefined;
	const fetchTrack = async (track: CaptionTrack): Promise<PanelSegment[]> => {
		let proof = proofFor(track, snapshot!);
		if (!proof.pot) {
			// The player has not asked for these captions yet: switch them on so it does, then put the switch back.
			const switched = (await io.ask<{ changed?: boolean }>({ type: 'captions', on: true }))?.changed === true;
			for (let attempt = 0; attempt < 25 && !proof.pot; attempt++) {
				await io.sleep(200);
				snapshot = (await io.ask<BridgeSnapshot>({ type: 'snapshot' }, 1200)) ?? snapshot;
				proof = proofFor(track, snapshot!);
			}
			if (switched) await io.ask({ type: 'captions', on: false });
		}
		const address = captionAddress(track, snapshot!, proof);
		if (!isCaptionAddress(address)) return [];
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const response = await io.fetch(address, { credentials: 'include' });
				if (response.ok) { const segments = parseCaptions(await response.text()); if (segments.length) return segments; }
			} catch { /* try again */ }
			await io.sleep(500);
		}
		return [];
	};
	return { tracks: infos, chosen, fetchTrack };
}

export async function fetchCaptionsViaPlayer(videoId: string, preferred?: string, io: PlayerIo = defaultIo()): Promise<CaptionResult | undefined> {
	const opened = await openPlayerCaptions(videoId, preferred, io);
	if (!opened) return undefined;
	const segments = await opened.fetchTrack(opened.chosen.track);
	return segments.length ? { segments, tracks: opened.tracks, selected: opened.chosen.id, fetchTrack: opened.fetchTrack } : undefined;
}

// The captions of a video: the way the player reads them first, then the older routes.
export async function fetchBestCaptions(videoId: string, doc: Document, preferred?: string, io?: PlayerIo): Promise<CaptionResult> {
	try { const viaPlayer = await fetchCaptionsViaPlayer(videoId, preferred, io); if (viaPlayer) return viaPlayer; } catch { /* the older routes */ }
	return fetchCaptionResult(videoId, doc, undefined, preferred);
}
