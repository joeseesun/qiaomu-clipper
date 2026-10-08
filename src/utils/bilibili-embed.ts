import { t } from './ui-text';
// Bilibili's own embed (https://player.bilibili.com/player.html). Obsidian notes show it as a player; the RSS site and the
// RSS plugin do not run page HTML, so there a clip carries a plain link instead.
const EMBED = /<iframe\b[^>]*?\bsrc=(["'])([^"']*player\.bilibili\.com\/player\.html[^"']*)\1[^<>]*>?\s*(?:<\/iframe>?)?/gi;

function videoOf(src: string): { bvid: string; page: number } | null {
	try {
		const url = new URL(src.replace(/&amp;/g, '&'), 'https://player.bilibili.com/');
		const bvid = url.searchParams.get('bvid') || '';
		if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;
		const page = parseInt(url.searchParams.get('p') || url.searchParams.get('page') || '1', 10);
		return { bvid, page: Number.isFinite(page) && page > 0 ? page : 1 };
	} catch { return null; }
}

export const bilibiliWatchUrl = (bvid: string, page = 1) => `https://www.bilibili.com/video/${bvid}/${page > 1 ? `?p=${page}` : ''}`;

// A well-formed player for an outside page: `isOutside` lets it load there, and nothing starts playing on its own.
export function bilibiliPlayerHtml(bvid: string, page = 1): string {
	return `<iframe src="https://player.bilibili.com/player.html?isOutside=true&bvid=${bvid}&p=${page}&autoplay=0&high_quality=1&danmaku=0" width="100%" height="450" scrolling="no" frameborder="no" allowfullscreen="true"></iframe>`;
}

export function normalizeBilibiliEmbeds(markdown: string): string {
	return markdown.replace(EMBED, (whole, _quote, src: string) => { const video = videoOf(src); return video ? bilibiliPlayerHtml(video.bvid, video.page) : whole; });
}

// An embed shown as text arrives HTML-escaped (`&lt;iframe …&gt;`); turn it back so it is recognised and replaced too.
const ESCAPED_EMBED = /&lt;iframe\b(?:(?!&lt;)[^<>])*?player\.bilibili\.com\/player\.html(?:(?!&lt;)[^<>])*?&gt;\s*(?:&lt;\/iframe&gt;)?/gi;
const unescapeEmbeds = (markdown: string) => markdown.replace(ESCAPED_EMBED, m => m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));

export function bilibiliEmbedsToLinks(markdown: string): string {
	return unescapeEmbeds(markdown).replace(EMBED, (whole, _quote, src: string) => { const video = videoOf(src); return video ? t('[▶ 在 B 站观看]({0})', [bilibiliWatchUrl(video.bvid, video.page)]) : whole; });
}
