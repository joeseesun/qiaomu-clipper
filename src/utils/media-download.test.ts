import { describe, expect, it, vi } from 'vitest';
import { DownloadError, defaultChoice, downloadFileName, downloadProblem, fetchMediaBlob, guessChoice, humanSize } from './media-download';

const reply = (chunks: string[], init: ResponseInit = {}) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), { headers: { 'content-type': 'video/mp4', 'content-length': String(chunks.join('').length) }, ...init });

describe('media download', () => {
	it('makes a readable file name every system accepts', () => {
		expect(downloadFileName('我们学英语都学错了！ #学英语 #英语口语 #english', 'mp4')).toBe('我们学英语都学错了！.mp4');
		expect(downloadFileName('a/b:c*d?"e<f>g|h', 'MP4')).toBe('a b c d e f g h.mp4');
		expect(downloadFileName('  ...  ', 'm4a')).toBe('乔木剪藏.m4a');
		expect(downloadFileName('x'.repeat(200), 'mp3').length).toBe(64);
		expect(downloadFileName('t', '../evil')).toBe('t.evil');
	});

	it('knows an audio file from a video file by its address', () => {
		expect(guessChoice('https://cdn.example.com/ep1.m4a?x=1', false)).toEqual({ kind: 'audio', ext: 'm4a' });
		expect(guessChoice('https://cdn.example.com/stream', false)).toEqual({ kind: 'audio', ext: 'mp3' });
		expect(guessChoice('https://v16.tiktok.com/video/tos/x/', true)).toEqual({ kind: 'video', ext: 'mp4' });
		expect(guessChoice('https://cdn.example.com/a.webm', true)).toEqual({ kind: 'video', ext: 'webm' });
		expect(guessChoice('https://cdn.example.com/a.mp3', true)).toEqual({ kind: 'video', ext: 'mp4' });
	});

	it('prefers the remembered choice while it is still offered', () => {
		const choices = [{ id: '1080', label: '1080p', url: 'u1', kind: 'video' as const, ext: 'mp4' }, { id: '720', label: '720p', url: 'u2', kind: 'video' as const, ext: 'mp4' }];
		expect(defaultChoice(choices, '720')?.id).toBe('720');
		expect(defaultChoice(choices, '480')?.id).toBe('1080');
		expect(defaultChoice([], '720')).toBeUndefined();
		expect(humanSize(48 * 1048576)).toBe('48 MB'); expect(humanSize(2048)).toBe('2 KB'); expect(humanSize(undefined)).toBe('');
	});

	it('reads the file with progress', async () => {
		const progress = vi.fn();
		const blob = await fetchMediaBlob('https://x/f.mp4', { fetcher: vi.fn(async () => reply(['abc', 'defg'])) as unknown as typeof fetch, onProgress: progress });
		expect(blob.size).toBe(7); expect(blob.type).toBe('video/mp4');
		expect(progress).toHaveBeenLastCalledWith(7, 7);
	});

	it('turns the usual failures into a plain sentence', async () => {
		const failing = (response: Response | Error) => ({ fetcher: vi.fn(async () => { if (response instanceof Error) throw response; return response; }) as unknown as typeof fetch });
		await expect(fetchMediaBlob('https://x', failing(new Response('no', { status: 403 })))).rejects.toMatchObject({ code: 'http', message: 'HTTP 403' });
		await expect(fetchMediaBlob('https://x', failing(new Response('<html>', { headers: { 'content-type': 'text/html' } })))).rejects.toMatchObject({ code: 'not-media' });
		await expect(fetchMediaBlob('https://x', failing(new TypeError('Failed to fetch')))).rejects.toMatchObject({ code: 'network' });
		expect(downloadProblem(new DownloadError('http', 'HTTP 403'))).toContain('链接已失效');
		expect(downloadProblem(new DownloadError('network', 'x'))).toContain('网络');
		expect(downloadProblem(new DownloadError('cancelled', 'x'))).toBe('已取消');
		expect(downloadProblem(new Error('x'))).toBe('没能下载，请重试');
	});

	it('stops when asked', async () => {
		const controller = new AbortController(); controller.abort();
		const fetcher = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch;
		await expect(fetchMediaBlob('https://x', { fetcher, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
	});
});
