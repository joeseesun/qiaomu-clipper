// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePageAudio, PlaybackAudioWindows, type CapturedAudioWindow } from './page-audio-capture';

afterEach(() => vi.unstubAllGlobals());

describe('page audio windows', () => {
	it('splits on seeks, pauses and rate changes instead of using elapsed wall time', () => {
		const output: CapturedAudioWindow[] = [];
		const windows = new PlaybackAudioWindows(16000, value => output.push(value), 2);
		const audio = () => new Float32Array(16000).fill(0.1);
		windows.push(audio(), { time: 30, rate: 1, playing: true });
		windows.push(audio(), { time: 90, rate: 1, playing: true });
		windows.push(audio(), { time: 91, rate: 1, playing: false });
		windows.push(audio(), { time: 100, rate: 2, playing: true });
		windows.push(audio(), { time: 102, rate: 2, playing: true });
		expect(output.map(({ start, rate, duration }) => ({ start, rate, duration }))).toEqual([
			{ start: 30, rate: 1, duration: 1 }, { start: 90, rate: 1, duration: 1 }, { start: 100, rate: 2, duration: 2 },
		]);
	});
	it('flushes on a missing clock and discards silence or very short fragments', () => {
		const emit = vi.fn();
		const windows = new PlaybackAudioWindows(16000, emit, 2);
		windows.push(new Float32Array(16000), { time: 0, rate: 1, playing: true });
		windows.flush();
		windows.push(new Float32Array(100).fill(0.1), { time: 2, rate: 1, playing: true });
		windows.flush();
		expect(emit).not.toHaveBeenCalled();
		windows.push(new Float32Array(16000).fill(0.1), { time: 5, rate: 1, playing: true });
		windows.push(new Float32Array(2048), undefined);
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ start: 5, duration: 1 }));
	});
});

function captureFixture({ wrongTab = false, audio = true, moduleError = false } = {}) {
	let handle = '';
	const screen = { stop: vi.fn(), addEventListener: vi.fn(), getCaptureHandle: () => ({ handle: wrongTab ? 'other-tab' : handle }) };
	const sound = { stop: vi.fn(), addEventListener: vi.fn() };
	const tracks = audio ? [screen, sound] : [screen];
	const stream = { getTracks: () => tracks, getAudioTracks: () => audio ? [sound] : [], getVideoTracks: () => [screen] };
	const getDisplayMedia = vi.fn().mockResolvedValue(stream);
	vi.stubGlobal('location', { protocol: 'chrome-extension:' });
	vi.stubGlobal('navigator', { mediaDevices: {
		getDisplayMedia,
		setCaptureHandleConfig: (config: { handle: string }) => { handle = config.handle; },
	} });
	const close = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal('AudioContext', class {
		sampleRate = 48000;
		destination = {};
		audioWorklet = { addModule: vi.fn().mockImplementation(async () => { if (moduleError) throw new Error('worklet failed'); }) };
		createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
		resume = vi.fn().mockResolvedValue(undefined);
		close = close;
	});
	vi.stubGlobal('AudioWorkletNode', class {
		port = { close: vi.fn(), onmessage: null };
		connect = vi.fn(); disconnect = vi.fn();
	});
	vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
	document.body.innerHTML = '<article><video></video></article>';
	const article = document.querySelector('article')!;
	const controller = new AbortController();
	const options = { onWindow: vi.fn(), onStatus: vi.fn(), onStop: vi.fn(), signal: controller.signal };
	return { article, options, controller, tracks, close, getDisplayMedia };
}

it('rejects another tab and releases all of its tracks', async () => {
	const fixture = captureFixture({ wrongTab: true });
	await expect(capturePageAudio(fixture.article, fixture.options)).rejects.toThrow('当前学习页');
	fixture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
	expect(fixture.options.onStop).toHaveBeenCalledOnce();
});

it('requires shared tab audio instead of silently recording an empty stream', async () => {
	const fixture = captureFixture({ audio: false });
	await expect(capturePageAudio(fixture.article, fixture.options)).rejects.toThrow('没有共享标签页声音');
	fixture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
});

it('releases the stream and context when worklet loading fails', async () => {
	const fixture = captureFixture({ moduleError: true });
	await expect(capturePageAudio(fixture.article, fixture.options)).rejects.toThrow('worklet failed');
	fixture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
	expect(fixture.close).toHaveBeenCalledOnce();
});

it('stops tracks and the audio context exactly once on cancellation', async () => {
	const fixture = captureFixture();
	const capture = await capturePageAudio(fixture.article, fixture.options);
	fixture.controller.abort(); capture.stop();
	fixture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
	expect(fixture.close).toHaveBeenCalledOnce();
	expect(fixture.options.onStop).toHaveBeenCalledOnce();
});

it('releases a chooser result that arrives after cancellation', async () => {
	const fixture = captureFixture();
	const pending = capturePageAudio(fixture.article, fixture.options);
	fixture.controller.abort();
	await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	fixture.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce());
});
