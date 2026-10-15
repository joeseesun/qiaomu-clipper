import type { DefuddleResponse } from 'defuddle';
import type { WebInfo } from './asr-client';
import { t } from './ui-text';

// Access parameters are needed to reopen some notes. Keep them, but never tracking or fragments.
export function xhsAddress(address: string): string | null {
	try {
		const u = new URL(address), id = u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1];
		if (u.protocol !== 'https:' || !['www.xiaohongshu.com', 'xiaohongshu.com'].includes(u.hostname) || u.username || u.password || u.port || !id) return null;
		const out = new URL(`https://www.xiaohongshu.com/explore/${id.toLowerCase()}`);
		for (const key of ['xsec_token', 'xsec_source']) { const v = u.searchParams.get(key); if (v && v.length <= 512) out.searchParams.set(key, v); }
		return out.href;
	} catch { return null; }
}
export function xhsNoteId(address: string): string | undefined { const url = xhsAddress(address); return url ? new URL(url).pathname.split('/').pop() : undefined; }
export function xhsNoteRoot(doc: Document, address: string): HTMLElement | undefined {
	const id = xhsNoteId(address); if (!id) return;
	const root = doc.querySelector<HTMLElement>('#noteContainer');
	// The old modal remains briefly while SPA navigation loads the next note.
	if (!root || root.closest('[note-id]')?.getAttribute('note-id') !== id || root.hidden || root.getAttribute('aria-hidden') === 'true') return;
	return root;
}
function imageUrl(raw: string, address: string): string | undefined {
	try { const u = new URL(raw, address); if (u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'xhscdn.com' || u.hostname.endsWith('.xhscdn.com'))) return u.href; } catch { /* invalid */ }
}
function noteText(node: Element | null): string {
	if (!node) return '';
	const copy = node.cloneNode(true) as Element;
	copy.querySelectorAll('script,style,noscript').forEach(n => n.remove());
	copy.querySelectorAll('img').forEach(n => n.replaceWith(n.getAttribute('alt') || ''));
	copy.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
	return copy.textContent?.trim() || '';
}
export function extractXhsNote(doc: Document, address = doc.URL): DefuddleResponse | undefined {
	if (!xhsAddress(address)) return;
	const root = xhsNoteRoot(doc, address);
	if (!root) throw new Error(t('笔记还没加载完成，请在原页面打开笔记后重试。'));
	const title = noteText(root.querySelector('#detail-title'));
	const description = noteText(root.querySelector('#detail-desc'));
	const author = noteText(root.querySelector('.author .username, .author .name'));
	// Looping carousels prepend a copy of the last slide. Recover source order before deduplication.
	const slides = Array.from(root.querySelectorAll<HTMLImageElement>('.note-slider-img img'));
	const index = (img: HTMLImageElement) => Number(img.closest('[data-swiper-slide-index]')?.getAttribute('data-swiper-slide-index') ?? 0);
	slides.sort((a,b) => index(a) - index(b));
	const images = [...new Set(slides.map(img => imageUrl(img.currentSrc || img.getAttribute('src') || '', address)).filter((s): s is string => Boolean(s)))];
	const video = root.getAttribute('data-type') === 'video' ? root.querySelector<HTMLVideoElement>('video') : null;
	const cover = video?.poster ? imageUrl(video.poster, address) : undefined;
	if (!description && !images.length && !video) throw new Error(t('笔记还没加载完成，请在原页面打开笔记后重试。'));
	const article = doc.createElement('article');
	if (description) { const p = doc.createElement('p'); description.split('\n').forEach((line, i) => { if (i) p.append(doc.createElement('br')); p.append(line); }); article.append(p); }
	for (const src of video ? (cover ? [cover] : []) : images) { const img = doc.createElement('img'); img.src = src; img.alt = title; article.append(img); }
	if (video) { const link = doc.createElement('a'); link.href = xhsAddress(address)!; link.textContent = title || '小红书'; article.append(link); }
	return { title: title || description.split('\n')[0]?.slice(0, 120) || '小红书', description, author, content: article.innerHTML,
		domain: 'www.xiaohongshu.com', site: '小红书', image: cover || images[0] || '', published: '', language: 'zh-CN',
		favicon: '', parseTime: 0, wordCount: description.replace(/\s/g, '').length, schemaOrgData: {}, metaTags: [], variables: {} };
}
export function isXhsMedia(page: string, media: unknown): media is string {
	if (!xhsAddress(page) || typeof media !== 'string' || media.length > 8000) return false;
	try { const u = new URL(media); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && /^sns-video-[a-z0-9-]+\.xhscdn\.com$/.test(u.hostname) && /\.(?:mp4|m4a)$/.test(u.pathname); } catch { return false; }
}
export function xhsVideo(doc: Document, address: string): HTMLVideoElement | undefined {
	const root = xhsNoteRoot(doc, address); if (root?.getAttribute('data-type') !== 'video') return;
	return root.querySelector<HTMLVideoElement>('video') || undefined;
}
export function readXhsMedia(doc: Document, address: string): WebInfo | undefined {
	const v = xhsVideo(doc, address); if (!v) return;
	const src = v.currentSrc || v.src; if (!isXhsMedia(address, src)) return;
	const note = extractXhsNote(doc, address); if (!note) return;
	return { ok: true, title: note.title, author: note.author, description: note.description, site: '小红书', video: true,
		mediaUrl: src, thumbnail: note.image || null, seconds: Number.isFinite(v.duration) ? v.duration : null };
}

// Serialized into MAIN by scripting.executeScript. No imports or closure references here.
export function snapshotXhsPlayer(): { url: string; info?: WebInfo } {
	const u = new URL(location.href), id = u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1];
	if (u.protocol !== 'https:' || !['www.xiaohongshu.com', 'xiaohongshu.com'].includes(u.hostname) || u.username || u.password || u.port || !id) return { url: '' };
	const root = document.querySelector('#noteContainer');
	if (!root || root.closest('[note-id]')?.getAttribute('note-id') !== id || root.getAttribute('data-type') !== 'video') return { url: '' };
	const player = root.querySelector('video'); if (!player) return { url: '' };
	const state = (window as unknown as { __INITIAL_STATE__?: { note?: { noteDetailMap?: Record<string, { note?: any }> } } }).__INITIAL_STATE__;
	const note = state?.note?.noteDetailMap?.[id]?.note;
	if (!note || note.noteId !== id || note.type !== 'video') return { url: '' };
	const safe = (raw: unknown): string | undefined => {
		if (typeof raw !== 'string' || raw.length > 8000) return;
		try { const value = new URL(raw); if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.port || value.hash || !/^sns-video-[a-z0-9-]+\.xhscdn\.com$/.test(value.hostname)) return; value.protocol = 'https:'; return value.href; } catch { return; }
	};
	let media = note.video?.media;
	try { if (typeof note.video?.mediaV2 === 'string' && note.video.mediaV2.length < 500000) media = JSON.parse(note.video.mediaV2); } catch { /* older media shape */ }
	if (media?.video?.drm_type || media?.video?.drmType) return { url: '' };
	const streams = Object.values(media?.stream || {}).flat().filter((s: any) => s?.format?.toLowerCase() === 'mp4' && (s.audio_codec || s.audioCodec)) as any[];
	streams.sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
	const file = streams.map(s => safe(s.master_url || s.masterUrl)).find(Boolean) || safe(player.currentSrc);
	if (!file || !new URL(file).pathname.endsWith('.mp4')) return { url: '' };
	const audio = (Object.values(media?.audio_stream || {}).flat() as any[]).filter(s => s?.audio_codec === 'aac').sort((a,b) => (a.size || Infinity) - (b.size || Infinity)).map(s => safe(s.master_url)).find(Boolean);
	const title = String(note.title || note.desc || '').split('\n')[0].slice(0, 120) || '小红书';
	const poster = note.imageList?.[0]?.urlDefault;
	let thumbnail: string | null = null;
	try { const p = new URL(poster); if (p.protocol === 'https:' && !p.username && !p.password && !p.port && p.hostname.endsWith('.xhscdn.com')) thumbnail = p.href; } catch { /* no cover */ }
	return { url: u.href, info: { ok: true, title, author: String(note.user?.nickname || '').slice(0, 200), description: String(note.desc || '').slice(0, 6000),
		site: '小红书', video: true, mediaUrl: file, ...(audio ? { audioUrl: audio } : {}), thumbnail,
		seconds: Number.isFinite(player.duration) ? player.duration : Number(media?.video?.duration) || null } };
}

export async function getXhsPageMedia(address: string, sourceTabId: number | undefined,
	api: { get(id: number): Promise<{ url?: string }>; query(options: object): Promise<Array<{ id?: number; url?: string }>> },
	read: (id: number) => Promise<ReturnType<typeof snapshotXhsPlayer> | undefined>): Promise<WebInfo | undefined> {
	const id = xhsNoteId(address); if (!id) return;
	try {
		let tab: { id?: number; url?: string } | undefined;
		if (Number.isInteger(sourceTabId) && sourceTabId! >= 0) { try { tab = { ...await api.get(sourceTabId!), id: sourceTabId }; } catch { /* closed */ } }
		if (xhsNoteId(tab?.url || '') !== id) tab = (await api.query({ url: ['https://www.xiaohongshu.com/*', 'https://xiaohongshu.com/*'] })).find(t => xhsNoteId(t.url || '') === id);
		if (tab?.id === undefined || xhsNoteId(tab.url || '') !== id) return;
		const result = await read(tab.id), info = result?.info;
		if (xhsNoteId(result?.url || '') !== id || !info?.ok || !isXhsMedia(address, info.mediaUrl) || (info.audioUrl && !isXhsMedia(address, info.audioUrl))) return;
		return { ...info, title: String(info.title || '小红书').slice(0,600), author: String(info.author || '').slice(0,200), description: String(info.description || '').slice(0,6000), site: '小红书', video: true };
	} catch { return; }
}
