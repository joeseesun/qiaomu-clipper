import { transcriptHeadingTools } from './transcript-heading';
import { createElement, WandSparkles } from 'lucide';
import { mountClipChat } from './clip-chat';
import { learningNotes } from './learning-composer';
import { loadSettings } from './storage-utils';
import { youtubeVideoId } from './youtube-url';
import { bilibiliEmbedUrl, bilibiliVideo, TRANSCRIPT_SELECTOR, PLAYER_SELECTOR } from './video-source';
import { mountPlayerSize } from './youtube-player-size';
import { mountPlayerMode } from './youtube-player-mode';
import { mountTranslation } from './youtube-translation';

import { t } from './ui-text';
// Read only transcript segments, excluding chapter headings and reader controls.
export function transcriptText(article: HTMLElement): string {
	return Array.from(article.querySelectorAll(`${TRANSCRIPT_SELECTOR} .transcript-segment`)).map(segment => {
		const timestamp = segment.querySelector('strong')?.textContent?.trim() || '';
		const clone = segment.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('.transcript-translation').forEach(node => node.remove());
		clone.querySelector('strong')?.remove();
		const text = clone.textContent?.replace(/^\s*·\s*/, '').replace(/\s+/g, ' ').trim() || '';
		return text ? `${timestamp ? `[${timestamp}] ` : ''}${text}` : '';
	}).filter(Boolean).join('\n');
}

export async function mountYouTubeStudy(doc: Document, article: HTMLElement, title: string, url: string, existingChat?: { toggle: () => boolean }): Promise<void> {
	article.dataset.videoPlatform = article.querySelector('video.reader-video-player') ? 'web' : bilibiliVideo(url) || article.querySelector('iframe[src*="player.bilibili.com"]') ? 'bilibili' : 'youtube';
	// A podcast or a recording has no picture to size or to move around: it keeps its one layout.
	if (article.dataset.audioStudy !== 'true') { mountPlayerSize(article); mountPlayerMode(article); }
	if (article.querySelector('.youtube-study-feedback')) return;
	doc.documentElement.classList.add('youtube-study');
	// No duplicate transcript action row: copy/download/AI live in the shared bar.
	const feedback = doc.createElement('div'); feedback.className = 'youtube-study-feedback';
	const status = doc.createElement('span'); status.className = 'youtube-study-status'; status.setAttribute('role', 'status');
	feedback.append(status);
	const text = transcriptText(article);
	const transcript = article.querySelector(TRANSCRIPT_SELECTOR);
	if (transcript) transcriptHeadingTools(transcript).append(feedback); else article.append(feedback);
	const toggleGroup = article.querySelector<HTMLElement>('.player-toggle-group');
	const controls = toggleGroup || feedback;
	let chat: ReturnType<typeof mountClipChat> | undefined = existingChat;
	if (!text) {
		status.textContent = article.dataset.videoPlatform === 'bilibili'
			? t('未获取到字幕：视频可能没有字幕，B 站的 AI 字幕通常需要登录后才能获取。登录后重新进入学习模式可重试。')
			: t('未获取到字幕：视频可能没有字幕，或 YouTube 暂时限制了获取。打开原页转写文稿后再进入学习模式可重试。');
		return;
	}
	mountTranslation(article, controls, status);
	if (existingChat) return;
	await loadSettings();
	chat = mountClipChat({
		onLearningRecord: quote => { void learningNotes(doc)?.open({quote}); },
		onLearningAi: aiSupplement => { void learningNotes(doc)?.open({aiSupplement}); },
		getContext: () => ({ title, url, markdown: t('以下是视频字幕文稿，时间戳对应播放位置。仅依据文稿回答；文稿没有的信息请明确说明。\n\n{0}', [text]) }),
		onInsert: answer => {
			let notes = article.querySelector('.youtube-study-notes');
			if (!notes) { notes = doc.createElement('section'); notes.className = 'youtube-study-notes'; article.appendChild(notes); }
			const note = doc.createElement('p'); note.textContent = answer; notes.appendChild(note);
		},
	});
	// Standalone reader pages have no shared AI bar; use the existing reader nav.
	const nav = doc.querySelector('.obsidian-reader-nav');
	if (nav && !nav.querySelector('.youtube-study-ask')) {
		const ask = doc.createElement('button'); ask.type = 'button'; ask.className = 'nav-btn youtube-study-ask';
		ask.title = t('基于视频文稿提问'); ask.setAttribute('aria-label', ask.title); ask.append(createElement(WandSparkles));
		ask.addEventListener('click', () => chat?.toggle()); nav.append(ask);
	}
}

// Markdown intentionally drops iframes. Restore only a trusted YouTube player
// from the clip's source URL, and restore transcript classes lost in conversion.
export function restoreYouTubePlayer(article: HTMLElement, sourceUrl: string): boolean {
	const bilibili = bilibiliVideo(sourceUrl);
	if (bilibili) {
		const doc = article.ownerDocument;
		let frame = article.querySelector<HTMLIFrameElement>('iframe[src*="player.bilibili.com/player.html"]');
		if (!frame) {
			frame = doc.createElement('iframe'); frame.src = bilibiliEmbedUrl(bilibili); frame.title = t('Bilibili 视频播放器');
			frame.allow = 'autoplay; fullscreen; picture-in-picture';
		}
		article.prepend(frame);
		const transcript = article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
		if (transcript) frame.after(transcript);
		return true;
	}
	const videoId = youtubeVideoId(sourceUrl);
	if (!videoId) return false;
	const doc = article.ownerDocument;
	let iframe = article.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed/"]');
	if (!iframe) {
		iframe = doc.createElement('iframe');
		iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1`;
		iframe.title = t('YouTube 视频播放器');
		iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
	}
	article.prepend(iframe);
	let transcript = article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
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
