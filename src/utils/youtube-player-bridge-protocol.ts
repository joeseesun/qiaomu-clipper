// What the page-world bridge and the extension's content script say to each other over window.postMessage.
export const BRIDGE_CHANNEL = 'qiaomu-yt-player';

export interface BridgeTrack { url: string; languageCode: string; kind?: string; vssId?: string; name?: string }
export interface BridgeSnapshot {
	videoId: string | null;
	originalLanguage?: string;
	tracks: BridgeTrack[];        // the video's caption tracks
	audioTracks: BridgeTrack[];   // the addresses the player holds for them, with the proof YouTube asks for
	requestUrl: string | null;    // a caption request the player made itself
	state: number;
	device: string | null;
	clientVersion: string | null;
	captionsOn: boolean;
}
export type BridgeRequest = { channel: string; dir: 'req'; id: string } & ({ type: 'snapshot' } | { type: 'captions'; on: boolean });
