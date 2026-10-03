// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('./clip-chat', () => ({ mountClipChat: vi.fn(() => ({ toggle: vi.fn() })) }));
vi.mock('./clipboard-utils', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('./file-utils', () => ({ saveFile: vi.fn() }));
vi.mock('./storage-utils', () => ({ loadSettings: vi.fn(), getLocalStorage: vi.fn().mockResolvedValue(undefined), setLocalStorage: vi.fn().mockResolvedValue(undefined) }));
import { mountYouTubeStudy, transcriptText } from './youtube-study';
import { mountClipChat } from './clip-chat';
import { copyToClipboard } from './clipboard-utils';
import { saveFile } from './file-utils';

function article(html: string): HTMLElement {
	document.body.innerHTML = `<article>${html}</article>`;
	return document.querySelector('article')!;
}
const subtitles = '<div class="youtube transcript"><h2>Chapter</h2><p class="transcript-segment"><strong>0:12</strong> · Hello &amp; welcome.</p><div class="transcript-segment"><strong>1:03</strong><div class="transcript-segment-text">第二段内容。</div></div><button>Current position</button></div>';

describe('YouTube study transcript', () => {
	it('exports raw and wired subtitles without chapters, controls or HTML', () => {
		expect(transcriptText(article(subtitles))).toBe('[0:12] Hello & welcome.\n[1:03] 第二段内容。');
	});
	it('keeps translated paragraphs out of the original transcript exported and passed to AI', () => {
		const node = article(subtitles); const translated = document.createElement('div'); translated.className = 'transcript-translation'; translated.textContent = '你好，欢迎。'; node.querySelector('.transcript-segment')!.append(translated);
		expect(transcriptText(node)).toBe('[0:12] Hello & welcome.\n[1:03] 第二段内容。');
	});
	it('offers size adjustment before subtitles arrive without replacing the iframe', async () => {
		const node = article('<iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe>'); const player = node.querySelector('iframe');
		await mountYouTubeStudy(document,node,'Video','https://www.youtube.com/watch?v=dbqweBCynuI');
		expect(node.querySelector('.youtube-size-control input')).not.toBeNull(); expect(node.querySelector('iframe')).toBe(player);
		expect(node.querySelector('.youtube-translate-toggle')).toBeNull();
	});
	it('disables transcript actions when subtitles are unavailable', async () => {
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		expect(Array.from(node.querySelectorAll('button')).every(button => button.disabled)).toBe(true);
		expect(node.textContent).toContain('未获取到字幕');
	});
	it('copies and downloads the same timestamped transcript used for AI, with a safe filename', async () => {
		const node = article(subtitles);
		await mountYouTubeStudy(document, node, 'Video / title', 'https://www.youtube.com/watch?v=example');
		node.querySelector<HTMLButtonElement>('[aria-label="复制字幕"]')!.click();
		node.querySelector<HTMLButtonElement>('[aria-label="下载字幕（TXT）"]')!.click();
		const text = transcriptText(node);
		expect(copyToClipboard).toHaveBeenCalledWith(text);
		expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({ content: text, fileName: 'Video _ title-字幕.txt', mimeType: 'text/plain' }));
		const options = vi.mocked(mountClipChat).mock.calls.slice(-1)[0][0];
		expect(options.getContext().markdown).toContain(text);
		expect(options.getContext().markdown).not.toContain('Current position');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		expect(document.querySelectorAll('.youtube-study-toolbar')).toHaveLength(1);
	});
});

it('restores a player and timestamp metadata after Markdown strips embeds and classes', async () => {
	const { restoreYouTubePlayer } = await import('./youtube-study');
	const node = article('<p>Video description</p><h2>Transcript</h2><h3>Chapter</h3><p><strong>1:03</strong> · Actual subtitle</p>');
	expect(restoreYouTubePlayer(node, 'https://www.youtube.com/watch?v=dbqweBCynuI')).toBe(true);
	expect(node.firstElementChild?.tagName).toBe('IFRAME');
	expect(node.querySelector('iframe')?.src).toBe('https://www.youtube.com/embed/dbqweBCynuI?enablejsapi=1');
	expect(node.querySelector('.timestamp')?.getAttribute('data-timestamp')).toBe('63');
	expect(transcriptText(node)).toBe('[1:03] Actual subtitle');
	expect(node.children[1].className).toBe('youtube transcript');
	restoreYouTubePlayer(node, 'https://www.youtube.com/watch?v=dbqweBCynuI');
	expect(node.querySelectorAll('iframe')).toHaveLength(1);
});

it('does not embed lookalike hosts or malformed video IDs', async () => {
	const { restoreYouTubePlayer } = await import('./youtube-study');
	const node = article('<p>Article</p>');
	expect(restoreYouTubePlayer(node, 'https://youtube.com.evil.test/watch?v=dbqweBCynuI')).toBe(false);
	expect(restoreYouTubePlayer(node, 'https://www.youtube.com/watch?v=invalid')).toBe(false);
	expect(node.querySelector('iframe')).toBeNull();
});
