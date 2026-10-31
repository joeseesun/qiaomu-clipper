import browser from '../utils/browser-polyfill';
import type { ClipPreview } from '../utils/clip-preview';
import { createMarkdownContent } from '../utils/defuddle';
import { exportTranscript, type TranscriptExportMode } from '../utils/transcript-export';
import { parseEmbedUrl } from './editor/markdown-plugins';
import { blankArticle, getArticle, listArticles, saveArticle } from './articles';
import type { Article } from './types';
import { t } from '../utils/ui-text';

export interface ArticleSource {
	body?: string;
	captions?: string;
	description?: string;
	author?: string;
}

const controls = 'script,style,button,input,select,dialog,.transcript-heading-tools,.transcript-scrub-track,.youtube-study-toolbar,.youtube-study-feedback,.youtube-size-control,.youtube-player-resize,.player-controls,.player-toggle-group,[data-player-cues]';
const publicUrl = (raw: string) => {
	try { const url = new URL(raw); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};

// Capture source content before a clip template can omit the description or captions.
export function extractedArticleSource(result: { content?: string; description?: string; author?: string }, url: string): ArticleSource {
	const source: ArticleSource = { description: result.description || '', author: result.author || '' };
	if (typeof DOMParser === 'undefined') return source;
	const doc = new DOMParser().parseFromString(result.content || '', 'text/html');
	const transcript = doc.querySelector('.transcript');
	if (transcript) { source.captions = exportTranscript(transcript, url, 'original'); transcript.remove(); }
	doc.querySelectorAll(`${controls},iframe,video,audio,.player-container,.reader-video-wrapper`).forEach(el => el.remove());
	source.body = createMarkdownContent(doc.body.innerHTML, url).trim();
	return source;
}

function timestampLinks(markdown: string, source: string): string {
	const base = publicUrl(source);
	if (!base) return markdown;
	return markdown.replace(/\*\*(\d{1,3}:\d{2}(?::\d{2})?)\*\*/g, (_whole, stamp: string) => {
		const seconds = stamp.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
		const url = new URL(base); url.searchParams.set('t', String(seconds));
		return `[${stamp}](${url.href})`;
	});
}

export interface SourceSnapshot { title: string; markdown: string; captions: string; media: boolean; ready: boolean }
export function sourceSnapshot(draft: ClipPreview, article?: Element | null, mode?: TranscriptExportMode): SourceSnapshot {
	const url = publicUrl(draft.clip.url);
	const embed = parseEmbedUrl(url);
	const media = Boolean(draft.mediaReadUrl || draft.studySource || draft.localMedia || draft.remoteMedia || (embed && embed.kind !== 'tweet') || article?.querySelector('.transcript,video,iframe'));
	const source = draft.articleSource || {};
	const transcript = article?.querySelector('.transcript');
	const visibleTranslation = !!article?.querySelector('.youtube-translate-toggle input:checked,.transcript-translation:not([hidden])');
	const preferred = mode || (draft.transcriptExport?.mode !== 'display' ? draft.transcriptExport?.mode : undefined) || (visibleTranslation ? 'bilingual' : 'original');
	let captions = transcript?.querySelector('.transcript-segment') ? exportTranscript(transcript, draft.clip.url, preferred) : source.captions || '';
	captions = timestampLinks(captions, url);
	const attribution = url ? `> ${t('来源')}：[${new URL(url).hostname.replace(/^www\./, '')}](${url})${source.author ? ` · ${source.author.replace(/\n/g, ' ')}` : ''}` : '';
	let body = draft.clip.markdown.trim();
	if (!media && article) body = extractedArticleSource({ content: article.innerHTML }, draft.clip.url).body || body;
	if (media && !draft.studyEditedAt) {
		// Older previews have no raw source snapshot; derive it from the live reader.
		const raw = source.body !== undefined ? source : article ? extractedArticleSource({ content: article.innerHTML }, draft.clip.url) : undefined;
		if (raw) {
			const description = source.description?.trim();
			const intro = description ? `## ${t('视频简介')}\n\n${description}` : '';
			const rest = raw.body?.trim() || '';
			body = [intro, rest && (!description || !rest.includes(description)) ? rest : '', captions].filter(Boolean).join('\n\n');
		} else if (captions && !body.includes(captions)) body += `\n\n${captions}`;
		if (draft.readerAppendix && !body.includes(draft.readerAppendix.trim())) body += `\n\n${draft.readerAppendix.trim()}`;
	}
	if (media && draft.studyEditedAt) body = timestampLinks(body, url);
	if (!media && draft.readerAppendix && !body.includes(draft.readerAppendix.trim())) body += `\n\n${draft.readerAppendix.trim()}`;
	// A bare supported video URL becomes the writer's existing embed block.
	const video = media && embed && embed.kind !== 'tweet' && !body.split('\n').some(line => line.trim() === embed.url) ? embed.url : '';
	return { title: draft.clip.title, markdown: [attribution, video, body].filter(Boolean).join('\n\n'), captions, media, ready: !media || !!captions || !!draft.studyEditedAt };
}

const creates = new Map<string, Promise<Article>>();
export async function articleFromClip(draft: ClipPreview, article?: Element | null, mode?: TranscriptExportMode): Promise<Article> {
	const key = draft.local.requestId;
	const inFlight = creates.get(key); if (inFlight) return inFlight;
	const work = async () => {
		const previous = (await listArticles()).find(item => item.clipSource?.previewId === key);
		if (previous) { const saved = await getArticle(previous.id); if (saved && !saved.trashedAt) return saved; }
		const source = sourceSnapshot(draft, article, mode);
		const created: Article = {
			...blankArticle(), title: source.title, markdown: source.markdown, sourceUrl: publicUrl(draft.clip.url),
			clipSource: { previewId: key, readUrl: draft.mediaReadUrl || browser.runtime.getURL(`reader.html?preview=${encodeURIComponent(key)}`), waitingForCaptions: !source.ready, ...(!source.ready ? { initialMarkdown: source.markdown } : {}) },
		};
		return saveArticle(created);
	};
	const pending = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(`qiaomu-article-from-clip:${key}`, work) : work();
	creates.set(key, pending);
	try { return await pending; } finally { if (creates.get(key) === pending) creates.delete(key); }
}

export async function openSourcePage(url: string): Promise<void> {
	// Only extension-owned reader/writer pages can be opened through this handoff.
	const target = new URL(url, browser.runtime.getURL('reader.html'));
	const own = new URL(browser.runtime.getURL('reader.html'));
	if (target.protocol !== own.protocol || target.host !== own.host || !/\/(?:reader|write)\.html$/.test(target.pathname)) return;
	const tabs = await browser.tabs.query({ url: browser.runtime.getURL(target.pathname.slice(1)) + '*' });
	const found = tabs.find(tab => tab.url === target.href && tab.id !== undefined);
	if (found?.id !== undefined) { await browser.tabs.update(found.id, { active: true }); if (found.windowId !== undefined) await browser.windows.update(found.windowId, { focused: true }); }
	else await browser.tabs.create({ url: target.href });
}

export async function openClipArticle(draft: ClipPreview, article?: Element | null, mode?: TranscriptExportMode): Promise<void> {
	const saved = await articleFromClip(draft, article, mode);
	await openSourcePage(browser.runtime.getURL(`write.html?id=${saved.id}`));
}

// A late transcript may append to an edited draft, but must never replace the user's writing.
export function completeSourceImport(article: Article, draft: ClipPreview, markdown = article.markdown): Article | undefined {
	if (!article.clipSource?.waitingForCaptions || article.clipSource.previewId !== draft.local.requestId) return;
	const source = sourceSnapshot(draft);
	if (!source.ready || !source.captions) return;
	const untouched = markdown.trim() === article.clipSource.initialMarkdown?.trim();
	const description = draft.articleSource?.description?.trim();
	const lateContent = [description && !markdown.includes(description) ? `## ${t('视频简介')}\n\n${description}` : '', source.captions].filter(Boolean).join('\n\n');
	return {
		...article, markdown: untouched ? source.markdown : `${markdown.trimEnd()}\n\n${lateContent}`,
		clipSource: { ...article.clipSource, waitingForCaptions: false, initialMarkdown: undefined },
	};
}
