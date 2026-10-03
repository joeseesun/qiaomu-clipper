import { createElement, Copy, Download, WandSparkles } from 'lucide';
import { mountClipChat } from './clip-chat';
import { copyToClipboard } from './clipboard-utils';
import { saveFile } from './file-utils';
import { loadSettings } from './storage-utils';
import { youtubeVideoId } from './youtube-url';
import { mountPlayerSize } from './youtube-player-size';
import { mountTranslation } from './youtube-translation';

// Read only transcript segments, excluding chapter headings and reader controls.
export function transcriptText(article: HTMLElement): string {
	return Array.from(article.querySelectorAll('.youtube.transcript .transcript-segment')).map(segment => {
		const timestamp = segment.querySelector('strong')?.textContent?.trim() || '';
		const clone = segment.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('.transcript-translation').forEach(node => node.remove());
		clone.querySelector('strong')?.remove();
		const text = clone.textContent?.replace(/^\s*·\s*/, '').replace(/\s+/g, ' ').trim() || '';
		return text ? `${timestamp ? `[${timestamp}] ` : ''}${text}` : '';
	}).filter(Boolean).join('\n');
}

export async function mountYouTubeStudy(doc: Document, article: HTMLElement, title: string, url: string, existingChat?: { toggle: () => boolean }): Promise<void> {
	mountPlayerSize(article);
	if (doc.querySelector('.youtube-study-toolbar')) return;
	doc.documentElement.classList.add('youtube-study');
	const toolbar = doc.createElement('div');
	toolbar.className = 'youtube-study-toolbar';
	const label = doc.createElement('span');
	label.textContent = '视频文稿';
	const status = doc.createElement('span');
	status.className = 'youtube-study-status';
	status.setAttribute('role', 'status');
	toolbar.append(label, status);
	const text = transcriptText(article);
	const button = (name: string, glyph: Parameters<typeof createElement>[0], action: () => Promise<unknown> | unknown) => {
		const node = doc.createElement('button');
		node.type = 'button';
		node.title = name;
		node.setAttribute('aria-label', name);
		node.appendChild(createElement(glyph));
		node.disabled = !text;
		node.addEventListener('click', async () => {
			try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : '操作失败，请重试'; }
		});
		toolbar.appendChild(node);
		return node;
	};
	button('复制字幕', Copy, async () => { if (!await copyToClipboard(text)) throw new Error('字幕复制失败，请重试'); status.textContent = '字幕已复制'; });
	button('下载字幕（TXT）', Download, () => saveFile({ content: text, fileName: `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'YouTube'}-字幕.txt`, mimeType: 'text/plain', onError: error => { status.textContent = error.message; } }));
	const ask = button('基于视频文稿提问', WandSparkles, () => chat?.toggle());
	let chat: ReturnType<typeof mountClipChat> | undefined = existingChat;
	const transcript = article.querySelector('.youtube.transcript');
	if (transcript) transcript.before(toolbar); else article.appendChild(toolbar);
	if (!text) {
		status.textContent = '未获取到字幕：视频可能没有字幕，或 YouTube 暂时限制了获取。打开原页转写文稿后再进入学习模式可重试。';
		return;
	}
	mountTranslation(article, toolbar, status);
	if (existingChat) return;
	ask.disabled = true;
	await loadSettings();
	chat = mountClipChat({
		getContext: () => ({ title, url, markdown: `以下是视频字幕文稿，时间戳对应播放位置。仅依据文稿回答；文稿没有的信息请明确说明。\n\n${text}` }),
		onInsert: answer => {
			let notes = article.querySelector('.youtube-study-notes');
			if (!notes) { notes = doc.createElement('section'); notes.className = 'youtube-study-notes'; article.appendChild(notes); }
			const note = doc.createElement('p'); note.textContent = answer; notes.appendChild(note);
		},
	});
	ask.disabled = false;
}

// Markdown intentionally drops iframes. Restore only a trusted YouTube player
// from the clip's source URL, and restore transcript classes lost in conversion.
export function restoreYouTubePlayer(article: HTMLElement, sourceUrl: string): boolean {
	const videoId = youtubeVideoId(sourceUrl);
	if (!videoId) return false;
	const doc = article.ownerDocument;
	let iframe = article.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed/"]');
	if (!iframe) {
		iframe = doc.createElement('iframe');
		iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1`;
		iframe.title = 'YouTube 视频播放器';
		iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
		iframe.allowFullscreen = true;
	}
	article.prepend(iframe);
	let transcript = article.querySelector<HTMLElement>('.youtube.transcript');
	if (!transcript) {
		const heading = Array.from(article.querySelectorAll('h2')).find(node => /^transcript$|^转写文稿$|^字幕$/i.test(node.textContent?.trim() || ''));
		if (heading) {
			transcript = doc.createElement('div'); transcript.className = 'youtube transcript';
			let sibling: Element | null = heading.nextElementSibling;
			transcript.appendChild(heading);
			while (sibling && sibling.tagName !== 'H2') {
				const next: Element | null = sibling.nextElementSibling;
				if (sibling.matches('p')) {
					const strong = sibling.querySelector('strong');
					const time = strong?.textContent?.trim() || '';
					if (/^(?:\d+:)?\d+:\d{2}$/.test(time)) {
						sibling.classList.add('transcript-segment');
						const stamp = doc.createElement('span'); stamp.className = 'timestamp'; stamp.textContent = time;
						stamp.setAttribute('data-timestamp', String(time.split(':').reduce((value, part) => value * 60 + Number(part), 0)));
						strong!.replaceChildren(stamp);
					}
				}
				transcript.appendChild(sibling); sibling = next;
			}
		}
	}
	if (transcript) iframe.after(transcript);
	return true;
}
