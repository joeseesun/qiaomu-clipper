import { bilibiliVideo } from './video-source';

const EMBED_CODE = /^<iframe[\s\S]*player\.bilibili\.com[\s\S]*<\/iframe>$/i;

// Bilibili's share panel carries the embed code as plain text, and the extractor can pick it up as page text. Drop that
// line (it renders as a wall of tag text in Markdown, the reader and RSS) and lead with a plain link to the video.
export function tidyBilibiliContent(html: string, url: string): string {
	const video = bilibiliVideo(url);
	if (!video) return html;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const isCode = (element: Element) => EMBED_CODE.test((element.textContent || '').trim().replace(/&amp;/g, '&'));
	for (const element of Array.from(doc.body.querySelectorAll('*')).reverse()) {
		if (!element.isConnected || element.tagName === 'IFRAME' || !isCode(element)) continue;
		if (Array.from(element.children).some(child => child.tagName !== 'BR' && isCode(child))) continue;
		element.remove();
	}
	const link = doc.createElement('p'), anchor = doc.createElement('a');
	anchor.href = `https://www.bilibili.com/video/${video.bvid}/`; anchor.textContent = '在 B 站观看';
	link.append(anchor);
	if (!doc.body.querySelector('iframe[src*="player.bilibili.com"]')) doc.body.prepend(link);
	return doc.body.innerHTML;
}
