// Hand-off contract with the Qiaomu Publish Obsidian plugin (protocol v1). Keep in step with src/bridge/protocol.ts there.
// The plugin listens on 127.0.0.1 for one job and opens an editor page with `#qp=<port>.<token>`; this side reads the fragment,
// removes it from the address bar and exchanges the one-time token for the job.
export type PublishTargetId = 'x' | 'zhihu' | 'xhs';

export interface BridgeAsset { id: string; name: string; mime: string; bytes: number }

export interface BridgeJobContent {
	markdown?: string;
	html?: string;
	text?: string;
	topics?: string[];
	cover?: string;
	cards?: string[];
	summary?: string;
}

export interface BridgeJob {
	v: 1;
	id: string;
	target: PublishTargetId;
	title: string;
	noteName: string;
	content: BridgeJobContent;
	assets: BridgeAsset[];
}

export interface BridgeStatus {
	state: 'running' | 'done' | 'error' | 'cancelled';
	text?: string;
	url?: string;
	remoteId?: string;
	error?: { code?: string; message: string };
}

/** Which hosts each platform's landing page may be on. A job for one platform is never run in another platform's tab. */
export const TARGET_HOSTS: Record<PublishTargetId, string[]> = {
	x: ['x.com', 'twitter.com'],
	zhihu: ['zhuanlan.zhihu.com'],
	xhs: ['creator.xiaohongshu.com'],
};

export interface Handoff { port: number; token: string }

const FRAGMENT = /^#qp=(\d{4,5})\.([0-9a-f]{32})$/;

/** Returns the hand-off carried by a tab address, or null when the address is not one of ours. */
export function parseHandoff(address: string | undefined): { handoff: Handoff; target: PublishTargetId } | null {
	if (!address) return null;
	let url: URL;
	try { url = new URL(address); } catch { return null; }
	if (url.protocol !== 'https:') return null;
	const match = FRAGMENT.exec(url.hash);
	if (!match) return null;
	const port = Number(match[1]);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
	const target = (Object.keys(TARGET_HOSTS) as PublishTargetId[]).find(id => TARGET_HOSTS[id].includes(url.hostname));
	return target ? { handoff: { port, token: match[2] }, target } : null;
}
