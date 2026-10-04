// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('./clip-chat', () => ({ mountClipChat: vi.fn(() => ({ toggle: vi.fn() })) }));
vi.mock('./clipboard-utils', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('./file-utils', () => ({ saveFile: vi.fn() }));
vi.mock('./storage-utils', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined), generalSettings: { translationModel: '', translationTargetLanguage: 'zh-CN' }, getLocalStorage: vi.fn().mockResolvedValue(undefined), setLocalStorage: vi.fn().mockResolvedValue(undefined) }));
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
		expect(node.querySelector('.youtube-player-resize')).not.toBeNull(); expect(node.querySelector('iframe')).toBe(player);
		expect(node.querySelector('.youtube-translate-toggle')).toBeNull();
	});
	it('disables transcript actions when subtitles are unavailable', async () => {
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		expect(Array.from(node.querySelectorAll('button')).every(button => button.disabled)).toBe(true);
		expect(node.textContent).toContain('未获取到字幕');
	});
	it('uses the shared top-bar chat without adding a duplicate AI entry or panel', async () => {
		const node=article(subtitles);const chat={toggle:vi.fn(() => true)};const count=vi.mocked(mountClipChat).mock.calls.length;
		await mountYouTubeStudy(document,node,'Video','https://www.youtube.com/watch?v=dbqweBCynuI',chat);
		expect(node.querySelector('[aria-label="基于视频文稿提问"]')).toBeNull();
		expect(vi.mocked(mountClipChat).mock.calls).toHaveLength(count);
	});
	it('omits duplicate size/transcript action rows and places translation beside sentence highlighting', async () => {
		const node = article('<div class="player-toggle-group"><label>标出当前句子</label></div>'+subtitles);
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=dbqweBCynuI', {toggle: () => true});
		expect(node.querySelector('.youtube-study-toolbar, .youtube-size-control')).toBeNull();
		expect(node.querySelector('[aria-label="复制字幕"], [aria-label="下载字幕（TXT）"]')).toBeNull();
		expect(node.querySelector('.player-toggle-group .youtube-translate-toggle')).not.toBeNull();
		expect(node.querySelector('.player-toggle-group .youtube-translation-target')).not.toBeNull();
		await mountYouTubeStudy(document,node,'Video','https://www.youtube.com/watch?v=dbqweBCynuI');
		expect(node.querySelectorAll('.youtube-translate-toggle')).toHaveLength(1);
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
