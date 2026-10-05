// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('./clip-chat', () => ({ mountClipChat: vi.fn(() => ({ toggle: vi.fn() })) }));
vi.mock('./clipboard-utils', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('./file-utils', () => ({ saveFile: vi.fn() }));
vi.mock('./storage-utils', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined), generalSettings: { translationModel: '', translationTargetLanguage: 'zh-CN' }, getLocalStorage: vi.fn().mockResolvedValue(undefined), setLocalStorage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./browser-whisper', async () => ({
	...await vi.importActual('./browser-whisper'),
	loadBrowserWhisper: vi.fn().mockResolvedValue({ model: 'test', device: 'wasm', transcriber: vi.fn() }),
	transcribeBrowserAudio: vi.fn().mockResolvedValue({
		text: 'Local caption', model: 'test', device: 'wasm',
		chunks: [{ timestamp: [1, 3], text: 'Local caption' }],
		segments: [{ time: '0:01', text: 'Local caption' }],
	}),
	formatSrt: vi.fn().mockReturnValue('1\n00:00:01,000 --> 00:00:03,000\nLocal caption\n'),
}));
vi.mock('./page-audio-capture', () => ({
	canCapturePageAudio: vi.fn().mockReturnValue(false),
	capturePageAudio: vi.fn(),
}));
import { mountYouTubeStudy, transcriptText } from './youtube-study';
import { mountClipChat } from './clip-chat';
import { copyToClipboard } from './clipboard-utils';
import { saveFile } from './file-utils';
import { transcribeBrowserAudio } from './browser-whisper';
import { canCapturePageAudio, capturePageAudio } from './page-audio-capture';

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
		expect(node.querySelector('.youtube-translate-toggle.is-unavailable')).not.toBeNull();
	});
	it('disables transcript actions when subtitles are unavailable', async () => {
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		expect(node.querySelector<HTMLButtonElement>('.youtube-whisper-start')?.disabled).toBe(false);
		expect(node.textContent).toContain('未获取到字幕');
	});
	it('keeps local Whisper controls without source subtitles and mounts generated captions separately', async () => {
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		const choose = node.querySelector<HTMLButtonElement>('.youtube-whisper-start')!;
		const input = node.querySelector<HTMLInputElement>('.youtube-whisper-controls input[type=file]')!;
		expect(choose).not.toBeNull();
		const file = new File(['audio'], 'sample.webm', { type: 'audio/webm' });
		Object.defineProperty(input, 'files', { configurable: true, value: [file] });
		input.dispatchEvent(new Event('change'));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(vi.mocked(transcribeBrowserAudio)).toHaveBeenCalledWith(file, expect.objectContaining({ language: undefined, signal: expect.any(AbortSignal) }));
		expect(node.querySelector('.transcript[data-source="browser-whisper"] .transcript-segment-text')).toBeNull();
		expect(node.querySelector<HTMLButtonElement>('.youtube-whisper-confirm')?.hidden).toBe(false);
		node.querySelector<HTMLButtonElement>('.youtube-whisper-confirm')!.click();
		expect(node.querySelector('.transcript[data-source="browser-whisper"] .transcript-segment-text')?.textContent).toBe('Local caption');
		expect(node.querySelector('.youtube-translate-toggle.is-unavailable')).toBeNull();
		expect(node.querySelector('.youtube-translate-toggle')).not.toBeNull();
		expect(node.querySelector('.youtube-whisper-copy')).not.toBeNull();
		expect(node.querySelector('.youtube-whisper-download-bilingual')).not.toBeNull();
		expect(transcriptText(node)).toBe('[0:01] Local caption');
		expect(choose.textContent).toBe('重新选择音频');
	});
	it('maps Reader regional language values to Whisper model language codes', async () => {
		vi.mocked(transcribeBrowserAudio).mockClear();
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=example');
		node.querySelector<HTMLButtonElement>('.youtube-translation-picker-option[data-value="zh-CN"]')?.click();
		const input = node.querySelector<HTMLInputElement>('.youtube-whisper-controls input[type=file]')!;
		const file = new File(['audio'], 'sample.webm', { type: 'audio/webm' });
		Object.defineProperty(input, 'files', { configurable: true, value: [file] });
		input.dispatchEvent(new Event('change'));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(vi.mocked(transcribeBrowserAudio)).toHaveBeenCalledWith(file, expect.objectContaining({ language: 'zh' }));
	});
	it('captures page audio and scales timestamps for playback speed, keeping capture across late subtitles', async () => {
		vi.mocked(canCapturePageAudio).mockReturnValue(true);
		let callbacks: Parameters<typeof capturePageAudio>[1];
		const stop = vi.fn(() => callbacks.onStop());
		vi.mocked(capturePageAudio).mockImplementation(async (_article, options) => { callbacks = options; return { stop }; });
		const node = article('<iframe></iframe>');
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=dbqweBCynuI');
		node.querySelector<HTMLButtonElement>('.youtube-whisper-page')!.click();
		await new Promise(resolve => setTimeout(resolve, 0));
		node.querySelector('.youtube-study-feedback')!.remove();
		node.insertAdjacentHTML('beforeend', subtitles);
		await mountYouTubeStudy(document, node, 'Video', 'https://www.youtube.com/watch?v=dbqweBCynuI');
		expect(node.querySelectorAll('.youtube-whisper-controls')).toHaveLength(1);
		expect(stop).not.toHaveBeenCalled();
		callbacks!.onWindow({ audio: new Float32Array(16000), start: 120, rate: 2, duration: 4 });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(node.querySelector<HTMLButtonElement>('.youtube-whisper-confirm')?.hidden).toBe(false);
		node.querySelector<HTMLButtonElement>('.youtube-whisper-confirm')!.click();
		expect(node.querySelector('.transcript[data-source="browser-whisper"] .timestamp')?.textContent).toBe('2:02');
		node.querySelector<HTMLButtonElement>('.youtube-whisper-stop')!.click();
		expect(stop).toHaveBeenCalledOnce();
		expect(node.querySelector<HTMLButtonElement>('.youtube-whisper-page')!.disabled).toBe(false);
		vi.mocked(canCapturePageAudio).mockReturnValue(false);
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
