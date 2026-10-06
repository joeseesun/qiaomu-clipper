import { resampleMono } from './browser-whisper';
import { PLAYER_SELECTOR } from './video-source';

export interface PlaybackSample { time: number; rate: number; playing: boolean }
export interface CapturedAudioWindow { audio: Float32Array; start: number; rate: number; duration: number }
type CaptureDevices = MediaDevices & {
	setCaptureHandleConfig?: (config: { handle: string; permittedOrigins: string[] }) => void;
};
type CaptureTrack = MediaStreamTrack & { getCaptureHandle?: () => { handle?: string } | null };

export function canCapturePageAudio(): boolean {
	return typeof location !== 'undefined' && location.protocol === 'chrome-extension:'
		&& typeof navigator.mediaDevices?.getDisplayMedia === 'function'
		&& typeof (navigator.mediaDevices as CaptureDevices).setCaptureHandleConfig === 'function'
		&& typeof AudioWorkletNode !== 'undefined';
}

/** Bounded PCM windows with video timestamps; discontinuities start a new window. */
export class PlaybackAudioWindows {
	private parts: Float32Array[] = [];
	private length = 0;
	private start = 0;
	private rate = 1;
	private expected = 0;
	constructor(private sampleRate: number, private emit: (window: CapturedAudioWindow) => void, private seconds = 6) {}
	push(audio: Float32Array, playback: PlaybackSample | undefined): void {
		if (!playback?.playing || !Number.isFinite(playback.time) || !Number.isFinite(playback.rate) || playback.rate <= 0) {
			this.flush(); return;
		}
		if (this.length && (playback.rate !== this.rate || Math.abs(playback.time - this.expected) > 0.5)) this.flush();
		if (!this.length) { this.start = Math.max(0, playback.time); this.rate = playback.rate; }
		this.parts.push(audio); this.length += audio.length;
		this.expected = playback.time + audio.length / this.sampleRate * playback.rate;
		if (this.length / this.sampleRate >= this.seconds) this.flush();
	}
	flush(): void {
		const length = this.length, parts = this.parts;
		this.parts = []; this.length = 0;
		if (length < this.sampleRate * 0.5) return;
		const samples = new Float32Array(length); let offset = 0;
		for (const part of parts) { samples.set(part, offset); offset += part.length; }
		// Quiet windows otherwise often produce Whisper hallucinations.
		let energy = 0; for (const value of samples) energy += value * value;
		if (Math.sqrt(energy / length) < 0.0005) return;
		this.emit({ audio: resampleMono(samples, this.sampleRate), start: this.start, rate: this.rate, duration: length / this.sampleRate });
	}
}

function playerClock(article: HTMLElement) {
	const doc = article.ownerDocument, view = doc.defaultView!;
	const video = article.querySelector<HTMLVideoElement>('video');
	const iframe = article.querySelector<HTMLIFrameElement>(PLAYER_SELECTOR);
	const session = crypto.randomUUID();
	let sample: PlaybackSample | undefined, received = 0;
	let origin: string | undefined;
	try { if (iframe) origin = new URL(iframe.src).origin; } catch { /* missing player URL */ }
	const onMessage = (event: MessageEvent) => {
		if (!iframe || event.source !== iframe.contentWindow || event.origin !== origin
			|| event.data?.type !== 'qiaomu-whisper-clock-result' || event.data.session !== session) return;
		const { time, rate, playing } = event.data;
		if (typeof time !== 'number' || !Number.isFinite(time) || typeof rate !== 'number' || !Number.isFinite(rate)) return;
		sample = { time, rate, playing: playing === true }; received = performance.now();
	};
	const poll = () => {
		if (iframe?.contentWindow && origin) iframe.contentWindow.postMessage({ type: 'qiaomu-whisper-clock', session }, origin);
	};
	view.addEventListener('message', onMessage);
	const interval = setInterval(poll, 200); poll();
	return {
		read(): PlaybackSample | undefined {
			if (video) return {
				time: video.currentTime, rate: video.playbackRate,
				playing: !video.paused && !video.ended && !video.seeking && video.readyState >= 3
					&& !doc.querySelector('.html5-video-player.ad-showing'),
			};
			const age = (performance.now() - received) / 1000;
			if (!sample || age > 1) return undefined;
			return { ...sample, time: sample.time + (sample.playing ? age * sample.rate : 0) };
		},
		destroy() { clearInterval(interval); view.removeEventListener('message', onMessage); },
	};
}

/** Called directly from a click so Chrome can display its tab-sharing chooser. */
export async function capturePageAudio(article: HTMLElement, options: {
	onWindow: (window: CapturedAudioWindow) => void;
	onStatus: (message: string) => void;
	onStop: () => void;
	signal: AbortSignal;
}): Promise<{ stop: () => void }> {
	if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
	if (!canCapturePageAudio()) throw new Error('页面取音需要在 Chrome 的学习页中使用；当前仍可选择音频文件');
	const devices = navigator.mediaDevices as CaptureDevices;
	const handle = `qiaomu-${crypto.randomUUID()}`;
	devices.setCaptureHandleConfig!({ handle, permittedOrigins: ['*'] });
	const clock = playerClock(article);
	let stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined;
	let processor: AudioWorkletNode | undefined, windows: PlaybackAudioWindows | undefined;
	let stopped = false;
	const stop = () => {
		if (stopped) return; stopped = true;
		options.signal.removeEventListener('abort', stop);
		clock.destroy();
		processor?.disconnect(); processor?.port.close(); source?.disconnect();
		stream?.getTracks().forEach(track => track.stop());
		void context?.close().catch(() => {});
		devices.setCaptureHandleConfig?.({ handle: '', permittedOrigins: [] });
		windows?.flush(); options.onStop();
	};
	options.signal.addEventListener('abort', stop, { once: true });
	try {
		stream = await devices.getDisplayMedia({
			video: { displaySurface: 'browser', frameRate: 1 },
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
			preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude', surfaceSwitching: 'exclude',
		} as DisplayMediaStreamOptions);
		if (stopped || options.signal.aborted) {
			stream.getTracks().forEach(track => track.stop());
			throw new DOMException('Aborted', 'AbortError');
		}
		const screen = stream.getVideoTracks()[0] as CaptureTrack | undefined;
		if (screen?.getCaptureHandle?.()?.handle !== handle) throw new Error('请选择当前学习页所在的标签页，才能让字幕时间与播放器一致');
		if (!stream.getAudioTracks().length) throw new Error('没有共享标签页声音，请重新选择当前标签页并勾选“同时共享标签页音频”');
		for (const track of stream.getTracks()) track.addEventListener('ended', stop, { once: true });
		context = new AudioContext();
		await context.audioWorklet.addModule(chrome.runtime.getURL('audio-capture-worklet.js'));
		if (stopped) throw new DOMException('Aborted', 'AbortError');
		source = context.createMediaStreamSource(stream);
		processor = new AudioWorkletNode(context, 'qiaomu-audio-capture');
		windows = new PlaybackAudioWindows(context.sampleRate, options.onWindow);
		let lastStatus = '', lastClockAt = performance.now();
		processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
			if (stopped) return;
			const playback = clock.read();
			if (playback) lastClockAt = performance.now();
			const status = playback?.playing ? '正在收听页面音频…' : playback ? '播放器已暂停，等待继续播放…' : '正在等待播放器时间…';
			if (lastStatus !== status) { lastStatus = status; options.onStatus(status); }
			if (!playback && performance.now() - lastClockAt > 15000) {
				// Keep the capture alive across iframe reloads, seeks and short
				// player stalls. The next valid clock sample can resume mapping;
				// only an ended capture track or explicit stop tears it down.
				if (lastStatus !== '正在等待播放器时间…') { lastStatus = '正在等待播放器时间…'; options.onStatus(lastStatus); }
				windows!.flush(); return;
			}
			// The worklet packet ends near "now"; map its beginning to media time.
			windows!.push(event.data, playback && { ...playback, time: playback.time - event.data.length / context!.sampleRate * playback.rate });
		};
		// The worklet emits silence. The original tab remains audible without feedback.
		source.connect(processor); processor.connect(context.destination);
		await context.resume();
		if (stopped) throw new DOMException('Aborted', 'AbortError');
		return { stop };
	} catch (error) { stop(); throw error; }
}
