import type { BridgeAsset, BridgeJob, BridgeStatus, Handoff } from './protocol';

export class BridgeError extends Error {
	constructor(message: string, readonly code: string) { super(message); }
}

/** Talks to the loopback server the plugin opened for this one job. */
export class BridgeClient {
	private session = '';
	cancelled = false;

	constructor(private readonly handoff: Handoff) {}

	private url(path: string): string { return `http://127.0.0.1:${this.handoff.port}${path}`; }

	async fetchJob(): Promise<BridgeJob> {
		let response: Response;
		try {
			response = await fetch(this.url('/v1/job'), { headers: { authorization: `Bearer ${this.handoff.token}` }, cache: 'no-store' });
		} catch {
			throw new BridgeError('连不上 Obsidian。请回到 Obsidian 重新点一次发布。', 'no-obsidian');
		}
		if (response.status === 410) throw new BridgeError('这次发布已经被取走，请回到 Obsidian 重新发布。', 'used');
		if (!response.ok) throw new BridgeError('Obsidian 拒绝了这次请求，请重新发布。', 'refused');
		const body = await response.json() as { v: number; session: string; job: BridgeJob };
		if (body.v !== 1) throw new BridgeError('乔木 Publish 版本和乔木 Clipper 不匹配，请更新其中一个。', 'version');
		this.session = body.session;
		return body.job;
	}

	async asset(asset: BridgeAsset): Promise<ArrayBuffer> {
		const response = await fetch(this.url(`/v1/asset/${encodeURIComponent(asset.id)}`), { headers: { authorization: `Bearer ${this.session}` }, cache: 'no-store' });
		if (!response.ok) throw new BridgeError(`读取图片失败：${asset.name}`, 'asset');
		return await response.arrayBuffer();
	}

	/** Reports progress. The reply says whether the person pressed stop in Obsidian; that is remembered in `cancelled`. */
	async status(status: BridgeStatus): Promise<void> {
		try {
			const response = await fetch(this.url('/v1/status'), { method: 'POST', headers: { authorization: `Bearer ${this.session}`, 'content-type': 'application/json' }, body: JSON.stringify(status) });
			if (response.ok) { const reply = await response.json() as { cancel?: boolean }; if (reply.cancel) this.cancelled = true; }
		} catch { /* Obsidian may already have closed the window; the draft is unaffected */ }
	}
}

export function bytesToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(binary);
}
