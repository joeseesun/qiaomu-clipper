// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('./storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {}, loadSettings: async () => {} }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
import { wireTranscript } from './reader-transcript';

const setup = () => {
	vi.stubGlobal('CSS', {});
	document.body.innerHTML = '<article><iframe src="https://player.bilibili.com/player.html?bvid=BV1hM4m1U7rA&p=1"></iframe><div class="bilibili transcript">'
		+ '<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="0">0:00</span></strong>First line.</p>'
		+ '<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="30">0:30</span></strong>Second line.</p>'
		+ '<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="60">1:00</span></strong>Third line.</p></div></article>';
	const article = document.querySelector('article')!, frame = article.querySelector('iframe')!;
	wireTranscript(document, article, { pinPlayer: false, autoScroll: false, highlightActiveLine: true }, { getStickyOffset: () => 0, scrollTo: () => {}, programmaticScroll: () => false }, () => {});
	return { article, frame, post: vi.spyOn(frame.contentWindow!, 'postMessage') };
};
const fromEmbed = (frame: HTMLIFrameElement, data: unknown) => window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
const active = (article: HTMLElement) => article.querySelector('.transcript-segment.is-active')?.textContent;

it('follows playback in the Bilibili embed once this extension\'s script inside it reports the time', () => {
	const { article, frame } = setup();
	expect(active(article)).toBeUndefined(); // nothing is known until the embed reports
	fromEmbed(frame, { qiaomuPlayer: 'time', time: 12.5, paused: false }); expect(active(article)).toContain('First line.');
	fromEmbed(frame, { qiaomuPlayer: 'time', time: 41, paused: false }); expect(active(article)).toContain('Second line.');
	fromEmbed(frame, { qiaomuPlayer: 'time', time: 75, paused: true }); expect(active(article)).toContain('Third line.');
});

it('ignores reports that do not come from the embed or are malformed', () => {
	const { article, frame } = setup();
	window.dispatchEvent(new MessageEvent('message', { data: { qiaomuPlayer: 'time', time: 41 }, source: window })); expect(active(article)).toBeUndefined();
	fromEmbed(frame, { qiaomuPlayer: 'time', time: 'soon' }); fromEmbed(frame, 'time=41'); fromEmbed(frame, null); expect(active(article)).toBeUndefined();
});

it('reloads the embed at the clicked second only until the script inside it has reported', () => {
	vi.useFakeTimers();
	const { article, frame } = setup(), src = frame.src;
	article.querySelectorAll<HTMLElement>('.timestamp')[1].click(); vi.advanceTimersByTime(400);
	expect(frame.src).not.toBe(src); expect(new URL(frame.src).searchParams.get('t')).toMatch(/^(3\d|60)$/); // no bridge: the old way, to a second in or at the end of that line
	vi.useRealTimers();
});

it('seeks inside the embed, without reloading it, once the script inside it has reported', () => {
	vi.useFakeTimers();
	const { article, frame, post } = setup(), src = frame.src;
	fromEmbed(frame, { qiaomuPlayer: 'time', time: 1, paused: false });
	article.querySelectorAll<HTMLElement>('.timestamp')[1].click(); vi.advanceTimersByTime(400);
	expect(frame.src).toBe(src); expect(post).toHaveBeenCalledWith(expect.objectContaining({ qiaomuPlayer: 'seek', play: true }), 'https://player.bilibili.com');
	expect((post.mock.calls[0][0] as { time: number }).time).toBeGreaterThanOrEqual(30);
	vi.useRealTimers();
});
