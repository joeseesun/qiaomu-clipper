import browser from './browser-polyfill';
import { cleanNotes } from './podcast-page';

// Reading an RSS feed for its newest episodes. Feeds can be many megabytes (years of episodes), so only the top is read: the
// newest come first. The parts that matter are found by pattern, because a feed cut off in the middle is not valid XML.
export interface FeedEpisode { guid: string; title: string; date?: string; seconds?: number; audio: string; notesHtml: string; link?: string }
export interface Feed { show: string; cover?: string; episodes: FeedEpisode[] }
const READ_LIMIT = 900_000, KEEP = 12, CACHE_KEY = 'qiaomuFeedCache', CACHE_MS = 30 * 60_000;

const unwrap = (value: string | undefined): string => {
	const text = (value ?? '').trim(), cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
	return cdata ? cdata[1].trim() : decodeEntities(text);
};
const decodeEntities = (text: string): string => text.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27|#(\d+));/g, (all, code) => code ? String.fromCodePoint(Number(code)) : ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'" } as Record<string, string>)[all] ?? all);
const tag = (block: string, name: string): string | undefined => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1];
const attr = (block: string, name: string, attribute: string): string | undefined => block.match(new RegExp(`<${name}\\b[^>]*?\\b${attribute}="([^"]*)"`, 'i'))?.[1];
export const durationSeconds = (value: string | undefined): number | undefined => {
	if (!value) return undefined; const text = value.trim();
	if (/^\d+$/.test(text)) return Number(text) || undefined;
	const parts = text.split(':').map(Number); if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part))) return undefined;
	return parts.reduce((total, part) => total * 60 + part, 0) || undefined;
};
const isoDate = (value: string | undefined): string | undefined => { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time).toISOString() : undefined; };
const httpsUrl = (value: string | undefined): string | undefined => { try { const url = new URL(decodeEntities(value ?? '')); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; } };

export function parseFeed(xml: string): Feed {
	const firstItem = xml.search(/<item[\s>]/), head = firstItem > 0 ? xml.slice(0, firstItem) : xml;
	const episodes: FeedEpisode[] = [];
	for (const block of xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []) {
		const audio = httpsUrl(attr(block, 'enclosure', 'url')); if (!audio) continue;
		const guid = unwrap(tag(block, 'guid')) || decodeEntities(attr(block, 'enclosure', 'url') ?? '');
		const notes = tag(block, 'content:encoded') ?? tag(block, 'description') ?? '';
		episodes.push({ guid, title: decodeEntities(unwrap(tag(block, 'title'))), audio, date: isoDate(unwrap(tag(block, 'pubDate'))), seconds: durationSeconds(unwrap(tag(block, 'itunes:duration'))), notesHtml: notes ? cleanNotes(unwrap(notes).slice(0, 40_000)) : '', link: httpsUrl(unwrap(tag(block, 'link'))) });
		if (episodes.length >= KEEP) break;
	}
	return { show: decodeEntities(unwrap(tag(head, 'title'))), cover: httpsUrl(attr(head, 'itunes:image', 'href') ?? tag(head.match(/<image[\s>][\s\S]*?<\/image>/)?.[0] ?? '', 'url')), episodes };
}

async function readTop(url: string): Promise<string> {
	const response = await fetch(url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' }, credentials: 'omit' });
	if (!response.ok || !response.body) throw new Error(`读取订阅源失败（${response.status}）`);
	const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '';
	for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); if (text.length >= READ_LIMIT) { void reader.cancel(); break; } }
	return text;
}

// A short memory, so opening the list again does not fetch every feed again.
type Cache = Record<string, { at: number; feed: Feed }>;
export async function fetchFeed(url: string, options: { fresh?: boolean; now?: number } = {}): Promise<Feed> {
	const now = options.now ?? Date.now();
	if (!httpsUrl(url)) throw new Error('订阅源地址必须是 https 地址');
	let cache: Cache = {};
	try { cache = ((await browser.storage.local.get(CACHE_KEY))[CACHE_KEY] as Cache | undefined) ?? {}; } catch { /* storage unavailable */ }
	const known = cache[url]; if (!options.fresh && known && now - known.at < CACHE_MS && known.feed.episodes.length) return known.feed;
	const feed = parseFeed(await readTop(url)); if (!feed.episodes.length) throw new Error('这个订阅源里没有找到可播放的节目');
	// Notes are the bulk; the list does not need them, and study mode reads the feed again for the one episode it opens.
	const slim: Feed = { ...feed, episodes: feed.episodes.map(item => ({ ...item, notesHtml: '' })) };
	try { const kept = Object.fromEntries(Object.entries(cache).filter(([, entry]) => now - entry.at < CACHE_MS)); await browser.storage.local.set({ [CACHE_KEY]: { ...kept, [url]: { at: now, feed: slim } } }); } catch { /* storage unavailable */ }
	return feed;
}

// The key a podcast episode is known by: the feed and the episode by hash, so the helper can check the address it is given.
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
export async function webKey(address: string): Promise<string> { return `web:${hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(address))).slice(0, 12)}`; }
export async function rssKey(feed: string, guid: string): Promise<string> {
	const sha = async (text: string, size: number) => hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))).slice(0, size);
	return `rss:${await sha(feed, 12)}:${await sha(guid, 16)}`;
}
