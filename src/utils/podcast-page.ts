import DOMPurify from 'dompurify';

// What a Xiaoyuzhou episode page says about the episode: the audio, the show, the date and the show notes. Read from the page's
// own HTML (the same address the viewer opened), never from a guess about the site's internals beyond a few stable names.
export interface PodcastEpisode { title: string; show: string; cover?: string; date?: string; minutes?: number; plays?: string; audio: string; notesHtml: string }

const MEDIA_HOST = /(^|\.)xyzcdn\.net$/;
const SITE_SUFFIX = /\s*[|｜-]\s*小宇宙\s*[-－–]?\s*听播客.*$/;
// The audio file the page names, only if it is on the platform's media host over https.
export function podcastAudioUrl(doc: Document, html = ''): string {
	const found = doc.querySelector('meta[property="og:audio"]')?.getAttribute('content') || html.match(/"enclosure":\{"url":"([^"]+)"/)?.[1];
	if (!found) throw new Error('没有在节目页面里找到音频地址');
	const audio = new URL(found.replace(/&amp;/g, '&'));
	if (audio.protocol !== 'https:' || !MEDIA_HOST.test(audio.hostname)) throw new Error('音频地址不在小宇宙的媒体域名下');
	return audio.href;
}

// Show notes are the host's own HTML: keep the formatting, drop anything active, open links in a new tab, and turn the
// timestamps they often list ("12:30 第二部分") into marks the player can jump to.
export function cleanNotes(html: string): string {
	const holder = document.createElement('div');
	holder.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'] });
	holder.querySelectorAll('a[href]').forEach(link => { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); });
	holder.querySelectorAll('img').forEach(image => { image.setAttribute('loading', 'lazy'); image.setAttribute('referrerpolicy', 'no-referrer'); });
	markTimestamps(holder);
	return holder.innerHTML;
}
const STAMP = /(?<![\d:.])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g;
export const stampSeconds = (hours: string | undefined, minutes: string, seconds: string): number => Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
// Wrap each "12:30" / "1:02:30" in the text (not inside a link) as <a class="qiaomu-seek" data-time="seconds">.
export function markTimestamps(root: HTMLElement): void {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!(node.parentElement?.closest('a'))) nodes.push(node as Text);
	for (const node of nodes) {
		const text = node.data; STAMP.lastIndex = 0; if (!STAMP.test(text)) continue; STAMP.lastIndex = 0;
		const fragment = document.createDocumentFragment(); let last = 0;
		for (const match of text.matchAll(STAMP)) {
			const at = match.index!; if (at > last) fragment.append(text.slice(last, at));
			const link = document.createElement('a'); link.className = 'qiaomu-seek'; link.href = '#'; link.dataset.time = String(stampSeconds(match[1], match[2], match[3])); link.textContent = match[0]; fragment.append(link); last = at + match[0].length;
		}
		if (last < text.length) fragment.append(text.slice(last));
		node.replaceWith(fragment);
	}
}

export function parsePodcastPage(html: string): PodcastEpisode {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const meta = (property: string) => doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') || undefined;
	const title = (doc.querySelector('h1')?.textContent || meta('og:title') || '').replace(SITE_SUFFIX, '').trim();
	const info = doc.querySelector('header .info')?.textContent || '';
	const minutes = Number(info.match(/(\d+)\s*分钟/)?.[1]) || undefined;
	const hours = Number(info.match(/(\d+)\s*小时/)?.[1]) || 0;
	const notes = doc.querySelector('.sn-content article') ?? doc.querySelector('section[aria-label*="show notes" i] article');
	return {
		title, audio: podcastAudioUrl(doc, html),
		show: doc.querySelector('.podcast-title a')?.textContent?.trim() || '',
		cover: meta('og:image'), date: doc.querySelector('time[datetime]')?.getAttribute('datetime')?.slice(0, 10),
		...(minutes || hours ? { minutes: hours * 60 + (minutes ?? 0) } : {}),
		notesHtml: notes ? cleanNotes(notes.innerHTML) : '',
	};
}
