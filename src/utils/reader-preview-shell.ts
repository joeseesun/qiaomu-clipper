import { createClipBar, autoHideBar, setClipBarHighlights } from './clip-bar';
import { mountClipChat } from './clip-chat';
import { ClipPreview, updateClipPreview } from './clip-preview';
import { generateFrontmatter } from './obsidian-note-creator';
import { getDomain } from './string-utils';
import { getHighlights } from './highlighter';
import { Reader } from './reader';
import browser from './browser-polyfill';
import { generalSettings } from './storage-utils';
import { listenTripleKey, normalizeTripleKeys } from './triple-key';
import { transcriptText } from './youtube-study';
import { videoKey } from './video-source';

// The same shell for a normal clip preview and a progressively loaded video.
export function mountReaderPreviewShell(draft: ClipPreview, pending = false) {
	const id = draft.local.requestId;
	document.documentElement.classList.add('qiaomu-preview');
	const title = document.createElement('span'); title.textContent = draft.clip.title;
	const openEditor = () => { location.href = browser.runtime.getURL(`editor.html?id=${id}`); };
	Reader.onEdit = openEditor;
	const chat = mountClipChat({
		onHighlight: () => Reader.highlightSelection(document),
		getContext: () => ({ title: draft.clip.title, url: draft.clip.url, markdown: videoKey(draft.clip.url) ? transcriptText(document.querySelector('article')!) || '尚未获取视频字幕文稿，请明确说明无法依据文稿回答。' : draft.clip.markdown }),
		onInsert: async text => {
			draft.clip.markdown = `${draft.clip.markdown.trimEnd()}\n\n${text}\n`;
			draft.local.content = await generateFrontmatter(draft.properties ?? []) + draft.clip.markdown;
			await updateClipPreview(draft);
		},
	});
	const bar = createClipBar({onToggleChat:chat.toggle, mode:'read', id, draft, title, domain:getDomain(draft.clip.url), url:draft.clip.url});
	document.body.prepend(bar);
	const readerSettings = document.querySelector('.obsidian-reader-settings');
	if (readerSettings) bar.querySelector('.clip-bar-extras')?.appendChild(readerSettings);
	autoHideBar(bar);
	const updateHighlights = () => setClipBarHighlights(bar, getHighlights().length);
	updateHighlights(); setTimeout(updateHighlights,800);
	browser.storage.onChanged.addListener(changes => { if (changes.highlights) setTimeout(updateHighlights,200); });
	const setPending = (value: boolean) => {
		pending = value;
		for (const control of Array.from(bar.querySelectorAll<HTMLButtonElement>('.clip-bar-segment button[aria-selected="false"], #clip-bar-copy, #clip-bar-download, #clip-bar-ai, #clip-bar-clip'))) control.disabled = value || (control.id === 'clip-bar-clip' && Boolean(draft.localDone && (!draft.aggregate || draft.rssDone))) || (control.id === 'clip-bar-ai' && Boolean(videoKey(draft.clip.url)) && !transcriptText(document.querySelector('article')!));
	};
	setPending(pending);
	listenTripleKey(() => [normalizeTripleKeys(generalSettings.tripleKeys).edit].filter(Boolean), () => { if (!pending) openEditor(); }, () => generalSettings.tripleKeyShortcuts !== false);
	return {bar,chat, setPending, refresh: () => {title.textContent = draft.clip.title;} };
}
