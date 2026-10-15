import { t } from './ui-text';
import { bilibiliVideo } from './video-source';
import { createElement, ExternalLink } from 'lucide';
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

export function mountBilibiliQualityLink(article: HTMLElement, sourceUrl: string): void {
	const video = bilibiliVideo(sourceUrl); if (!video) return;
	let link = article.querySelector<HTMLAnchorElement>('.bilibili-quality-link');
	if (!link) {
		link = article.ownerDocument.createElement('a'); link.className = 'bilibili-quality-link';
		link.textContent = t('原站高清');
		link.title = t('B 站外嵌画质受限，前往原网页选择高清');
		link.append(createElement(ExternalLink));
		link.target = '_blank'; link.rel = 'noopener noreferrer';
		link.style.cssText = 'grid-column:1/-1;display:inline-flex;align-items:center;gap:4px;margin:4px 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere';
		link.addEventListener('click', event => event.stopPropagation()); // Keep this source action out of the reader's follow-links navigation.
	}
	link.href = bilibiliWatchUrl(video.bvid, video.page);
	const host = article.querySelector('.player-container') || article.querySelector('.study-media-actions') || article;
	if (link.parentElement !== host) host.append(link);
}

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
