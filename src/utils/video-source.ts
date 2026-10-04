import { youtubeVideoId } from './youtube-url';

// Players the study layout can drive. YouTube exposes a JS API (time tracking, seeking in place);
// Bilibili's embed only accepts a start time in its URL, so a jump reloads the player.
export const PLAYER_SELECTOR = 'iframe[src*="youtube.com/embed/"], iframe[src*="player.bilibili.com/player.html"]';
// Fired on the article when the video's layout or pin state changes, so sizing can follow.
export const LAYOUT_EVENT = 'youtube-player-layout';
export const TRANSCRIPT_SELECTOR = '.transcript:is(.youtube, .bilibili)';

export interface BilibiliVideo { bvid: string; page: number }

export function bilibiliVideo(sourceUrl: string): BilibiliVideo | null {
	let source: URL;
	try { source = new URL(sourceUrl); } catch { return null; }
	if (!/^https?:$/.test(source.protocol)) return null;
	const host = source.hostname.toLowerCase();
	if (!['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(host)) return null;
	const bvid = source.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?/)?.[1];
	if (!bvid) return null;
	const page = parseInt(source.searchParams.get('p') || '1', 10);
	return { bvid, page: Number.isFinite(page) && page > 0 ? page : 1 };
}

export const isBilibiliEmbed = (src: string): boolean => /^https:\/\/player\.bilibili\.com\/player\.html/.test(src);

export function bilibiliEmbedUrl({ bvid, page }: BilibiliVideo, options: { start?: number; autoplay?: boolean } = {}): string {
	const url = new URL('https://player.bilibili.com/player.html');
	url.searchParams.set('isOutside', 'true'); url.searchParams.set('bvid', bvid); url.searchParams.set('p', String(page));
	url.searchParams.set('high_quality', '1'); url.searchParams.set('danmaku', '0');
	url.searchParams.set('autoplay', options.autoplay ? '1' : '0');
	if (options.start && options.start > 0) url.searchParams.set('t', String(Math.floor(options.start)));
	return url.toString();
}

// Same video on the same part: used to make sure the source tab was not navigated away.
export function videoKey(sourceUrl: string): string | null {
	const youtube = youtubeVideoId(sourceUrl);
	if (youtube) return `youtube:${youtube}`;
	const bilibili = bilibiliVideo(sourceUrl);
	return bilibili ? `bilibili:${bilibili.bvid}:${bilibili.page}` : null;
}

export function videoStudyPath(url: string, sourceTabId: number, title = ''): string | null {
	const platform = youtubeVideoId(url) ? 'youtube' : bilibiliVideo(url) ? 'bilibili' : null;
	if (!platform) return null;
	return `reader.html?study=${platform}&url=${encodeURIComponent(url)}&sourceTab=${sourceTabId}&title=${encodeURIComponent(title)}`;
}
