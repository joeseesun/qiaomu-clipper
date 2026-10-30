import { mountLearningNotes, type LearningNotes } from './utils/learning-composer';
import { loadSettings } from './utils/storage-utils';
import { youtubeVideoId } from './utils/youtube-url';
import { bilibiliVideo } from './utils/video-source';

// Injected on demand by the triple-press note shortcut (default `iii`) into any page. It opens the same quick-note card
// as the study view, with this page as the source and the current selection as the excerpt.
declare global { interface Window { qiaomuNoteCardGeneration?: number; qiaomuNoteCardDispose?: () => void; qiaomuNoteQuote?: string } }

const MAX_QUOTE = 4000;
let activeNotes: LearningNotes | undefined;

// The address the note links to: no fragment, and for YouTube the plain watch link without list/tracking parameters.
export function noteSourceUrl(href: string): string {
	try {
		const url = new URL(href); url.hash = '';
		const id = youtubeVideoId(href);
		if (id && /(^|\.)youtube\.com$/i.test(url.hostname)) return `https://www.youtube.com/watch?v=${id}`;
		return url.href;
	} catch { return href; }
}

const noteTitle = (doc: Document) => doc.title.replace(/[\p{Cf}\p{Cc}]/gu, '').replace(/\s*[-–|]\s*YouTube$/i, '').replace(/\s*[-_]\s*哔哩哔哩.*$/, '').trim() || doc.location.hostname;

// An ad shares the player with the video, so only the main video's time counts.
function playheadSeconds(doc: Document): number | undefined {
	if (!youtubeVideoId(doc.URL) && !bilibiliVideo(doc.URL)) return undefined;
	if (doc.querySelector('.html5-video-player.ad-showing')) return undefined;
	const video = doc.querySelector<HTMLVideoElement>('video.html5-main-video, video');
	return video && video.readyState > 0 && Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : undefined;
}

export function pageSelection(doc: Document): string {
	const selection = doc.getSelection();
	if (!selection || selection.isCollapsed) return '';
	const node = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
	if (node?.closest('.learning-composer')) return '';
	return selection.toString().trim().slice(0, MAX_QUOTE);
}

async function openNote(fallbackQuote?: string, current = () => true): Promise<void> {
	await loadSettings();
	if (!current()) return;
	const notes = mountLearningNotes({ doc: document, singleKey: false, getTime: () => playheadSeconds(document), getSource: () => ({ title: noteTitle(document), url: noteSourceUrl(document.URL) }) });
	activeNotes = notes;
	const quote = pageSelection(document) || fallbackQuote?.trim().slice(0, MAX_QUOTE) || '';
	await notes.open(quote ? { quote } : {});
}

try {
	{
		const generation = (window.qiaomuNoteCardGeneration ?? 0) + 1;
		window.qiaomuNoteCardGeneration = generation;
		try { window.qiaomuNoteCardDispose?.(); } catch { /* invalidated old context */ }
		const current = () => window.qiaomuNoteCardGeneration === generation;
		const messages = chrome.runtime.onMessage;
		const onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, _sender, sendResponse) => {
			if (!current()) return undefined;
			if (message?.action !== 'qiaomuOpenNote') return undefined;
			void openNote(typeof message.quote === 'string' ? message.quote : undefined, current).catch(() => {});
			sendResponse(true);
			return undefined;
		};
		messages.addListener(onMessage);
		window.qiaomuNoteCardDispose = () => {
			try { activeNotes?.dispose(); } finally { messages.removeListener(onMessage); }
		};
		const pending = window.qiaomuNoteQuote; window.qiaomuNoteQuote = undefined;
		void openNote(pending, current).catch(() => {});
	}
} catch {
	// The extension may have been updated while this page was open.
}
