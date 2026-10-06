import type { PanelSegment } from './youtube-panel-actions';

/**
 * Browser-only Whisper defaults. The model is downloaded on first use and then
 * cached by Transformers.js; no audio is sent to a remote transcription API.
 */
export const DEFAULT_BROWSER_WHISPER_MODEL = 'onnx-community/whisper-tiny';
export const WHISPER_SAMPLE_RATE = 16_000;
export const DEFAULT_WHISPER_WINDOW_SECONDS = 30;
export const DEFAULT_WHISPER_STRIDE_SECONDS = 5;

export type BrowserWhisperInput = Blob | ArrayBuffer | Float32Array | AudioBuffer;
export type WhisperDevice = 'webgpu' | 'wasm';

export interface BrowserWhisperProgress {
	phase: 'model' | 'transcribing';
	progress?: number;
	status?: string;
}

export interface BrowserWhisperCapabilities {
	supported: boolean;
	webgpu: boolean;
	wasm: boolean;
	message?: string;
}

export interface BrowserWhisperOptions {
	model?: string;
	device?: WhisperDevice;
	language?: string;
	task?: 'transcribe' | 'translate';
	/** Absolute video time in seconds for a captured window. */
	offsetSeconds?: number;
	chunkLengthSeconds?: number;
	strideLengthSeconds?: number;
	signal?: AbortSignal;
	onProgress?: (progress: BrowserWhisperProgress) => void;
	/** Injection point for tests and callers that keep a pipeline warm. */
	transcriber?: BrowserWhisperTranscriber;
}

export interface BrowserWhisperChunk {
	timestamp: [number | null, number | null];
	text: string;
}

export interface BrowserWhisperResult {
	text: string;
	chunks: BrowserWhisperChunk[];
	model: string;
	device: WhisperDevice;
	/** Reader-compatible caption rows, with timestamps relative to the video. */
	segments: PanelSegment[];
}

export interface BrowserWhisperTranscriber {
	(audio: Float32Array, options?: Record<string, unknown>): Promise<{
		text?: string;
		chunks?: Array<{ timestamp?: [number | null, number | null]; text?: string }>;
	}>;
}

type TransformersModule = {
	env: {
		backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean; wasmPaths?: { mjs: string; wasm: string } } } };
		useWasmCache?: boolean;
		allowLocalModels?: boolean;
		logLevel?: number;
	};
	pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<BrowserWhisperTranscriber>;
};

/**
 * Detect the minimum browser APIs needed by the local transcription path.
 * WebGPU is an acceleration option, not a requirement: ONNX WASM remains the
 * fallback for browsers without a GPU backend.
 */
export function browserWhisperCapabilities(scope: Pick<typeof globalThis, 'AudioContext' | 'WebAssembly' | 'navigator'> = globalThis): BrowserWhisperCapabilities {
	const hasAudio = typeof scope.AudioContext === 'function';
	const wasm = typeof scope.WebAssembly !== 'undefined';
	const webgpu = typeof (scope.navigator as Navigator & { gpu?: unknown } | undefined)?.gpu !== 'undefined';
	return {
		supported: hasAudio && wasm,
		webgpu,
		wasm,
		message: !hasAudio ? '当前浏览器不支持音频解码' : !wasm ? '当前浏览器不支持 WebAssembly' : undefined,
	};
}

function abortIfNeeded(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/** Convert a timestamp to the reader's compact clock format. */
export function whisperClock(seconds: number): string {
	const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
	const total = Math.floor(safe);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Resample mono PCM using linear interpolation; Whisper expects 16 kHz audio. */
export function resampleMono(samples: Float32Array, fromRate: number, toRate = WHISPER_SAMPLE_RATE): Float32Array {
	if (!samples.length || !Number.isFinite(fromRate) || fromRate <= 0 || fromRate === toRate) return samples;
	const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
	const output = new Float32Array(length);
	const ratio = fromRate / toRate;
	for (let index = 0; index < length; index++) {
		const source = index * ratio;
		const before = Math.floor(source);
		const after = Math.min(samples.length - 1, before + 1);
		const amount = source - before;
		output[index] = samples[before] * (1 - amount) + samples[after] * amount;
	}
	return output;
}

function monoFromAudioBuffer(buffer: AudioBuffer): Float32Array {
	const channels = buffer.numberOfChannels;
	if (channels <= 1) return new Float32Array(buffer.getChannelData(0));
	const output = new Float32Array(buffer.length);
	const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
	for (let index = 0; index < buffer.length; index++) {
		let sum = 0;
		for (const channel of channelData) sum += channel[index] || 0;
		output[index] = sum / channels;
	}
	return output;
}

/** Decode an audio file/blob in the browser and normalize it to mono 16 kHz PCM. */
export async function decodeBrowserAudio(input: BrowserWhisperInput, signal?: AbortSignal): Promise<Float32Array> {
	abortIfNeeded(signal);
	if (input instanceof Float32Array) return input;
	if (typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持音频解码');
	if (typeof AudioBuffer !== 'undefined' && input instanceof AudioBuffer) return resampleMono(monoFromAudioBuffer(input), input.sampleRate);
	const context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
	try {
		const raw = input instanceof ArrayBuffer ? input : input instanceof Blob ? await input.arrayBuffer() : undefined;
		if (!raw) throw new Error('不支持的音频输入');
		abortIfNeeded(signal);
		const decoded = await context.decodeAudioData(raw.slice(0));
		return resampleMono(monoFromAudioBuffer(decoded), decoded.sampleRate);
	} finally {
		await context.close().catch(() => {});
	}
}

function normalizeChunk(chunk: { timestamp?: [number | null, number | null]; text?: string }, offsetSeconds: number, fallbackStart: number): BrowserWhisperChunk | null {
	const text = (chunk.text || '').replace(/\s+/g, ' ').trim();
	if (!text) return null;
	const rawStart = chunk.timestamp?.[0];
	const rawEnd = chunk.timestamp?.[1];
	const start = offsetSeconds + (typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : fallbackStart);
	const endValue = typeof rawEnd === 'number' && Number.isFinite(rawEnd) ? rawEnd : (typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart + 4 : fallbackStart + 4);
	return { timestamp: [Math.max(0, start), Math.max(start, offsetSeconds + endValue)], text };
}

/** Turn Transformers.js chunks into stable reader rows, dropping malformed cues. */
export function chunksToPanelSegments(chunks: BrowserWhisperChunk[]): PanelSegment[] {
	return chunks
		.map(chunk => ({ time: whisperClock(chunk.timestamp[0] || 0), text: chunk.text.replace(/\s+/g, ' ').trim() }))
		.filter((segment, index, all) => segment.text && (index === 0 || segment.time !== all[index - 1].time || segment.text !== all[index - 1].text));
}

/** Format timed chunks as SubRip subtitles for export. */
export function formatSrt(chunks: BrowserWhisperChunk[]): string {
	const ordered = [...chunks].sort((a, b) => (a.timestamp[0] || 0) - (b.timestamp[0] || 0));
	return ordered.map((chunk, index) => {
		const start = srtClock(chunk.timestamp[0] || 0);
		const end = srtClock(Math.max(chunk.timestamp[0] || 0, chunk.timestamp[1] || (chunk.timestamp[0] || 0) + 4));
		return `${index + 1}\n${start} --> ${end}\n${chunk.text.replace(/\s+/g, ' ').trim()}\n`;
	}).join('\n');
}

function srtClock(seconds: number): string {
	const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
	const millis = Math.floor((safe % 1) * 1000);
	const total = Math.floor(safe);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/** Load a local Whisper pipeline when transcription starts. */
export async function loadBrowserWhisper(options: Pick<BrowserWhisperOptions, 'model' | 'device' | 'onProgress' | 'signal'> = {}): Promise<{ transcriber: BrowserWhisperTranscriber; model: string; device: WhisperDevice }> {
	abortIfNeeded(options.signal);
	const model = options.model || DEFAULT_BROWSER_WHISPER_MODEL;
	const capabilities = browserWhisperCapabilities();
	if (!capabilities.supported) throw new Error(capabilities.message || '当前浏览器无法运行浏览器内 Whisper');
	const device = options.device || (capabilities.webgpu ? 'webgpu' : 'wasm');
	if (device === 'webgpu' && !capabilities.webgpu) throw new Error('当前浏览器不支持 WebGPU，请切换为 WASM');
	options.onProgress?.({ phase: 'model', progress: 0, status: '正在下载或加载 Whisper 模型…' });
	// Extension pages may fail to load webpack's separate script chunk. Bundle
	// the runtime with its entry while deferring pipeline initialization.
	const transformers = await import(/* webpackMode: "eager" */ '@huggingface/transformers') as unknown as TransformersModule;
	// WASM threads are useful on desktop, but one thread avoids SharedArrayBuffer
	// requirements in extension pages and remains compatible with Safari.
	const wasm = transformers.env.backends?.onnx?.wasm;
	if (wasm) {
		wasm.numThreads = 1;
		wasm.proxy = false;
		// MV3 allows packaged modules, not CDN scripts or blob module imports.
		const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
		if (runtime?.getURL) {
			transformers.env.useWasmCache = false;
			transformers.env.allowLocalModels = false;
			wasm.wasmPaths = {
				mjs: runtime.getURL('whisper/ort-wasm-simd-threaded.asyncify.mjs'),
				wasm: runtime.getURL('whisper/ort-wasm-simd-threaded.asyncify.wasm'),
			};
		}
	}
	let loading = true;
	const initialize = (backend: WhisperDevice) => transformers.pipeline('automatic-speech-recognition', model, {
		device: backend, dtype: backend === 'webgpu' ? 'fp32' : 'q8',
		progress_callback: (event: { progress?: number; status?: string }) => loading && !options.signal?.aborted && options.onProgress?.({
			phase: 'model', progress: event.progress,
			status: typeof event.progress === 'number' ? `正在加载 Whisper 模型：${Math.round(event.progress)}%` : '正在下载或加载 Whisper 模型…',
		}),
	});
	let actualDevice = device;
	let transcriber: BrowserWhisperTranscriber;
	try {
		try { transcriber = await initialize(device); }
		catch (error) {
			abortIfNeeded(options.signal);
			if (device !== 'webgpu' || options.device) throw error;
			options.onProgress?.({ phase: 'model', status: 'WebGPU 初始化失败，正在切换到 WASM…' });
			actualDevice = 'wasm'; transcriber = await initialize('wasm');
		}
	} finally { loading = false; }
	abortIfNeeded(options.signal);
	options.onProgress?.({ phase: 'model', progress: 1, status: 'Whisper 模型已就绪' });
	return { transcriber, model, device: actualDevice };
}

/**
 * Transcribe a browser-captured audio window. `offsetSeconds` maps the local
 * window timestamps back to the source video, so callers can process playback
 * incrementally without pretending wall-clock time is video time.
 */
export async function transcribeBrowserAudio(input: BrowserWhisperInput, options: BrowserWhisperOptions = {}): Promise<BrowserWhisperResult> {
	abortIfNeeded(options.signal);
	const audio = await decodeBrowserAudio(input, options.signal);
	const loaded = options.transcriber ? { transcriber: options.transcriber, model: options.model || DEFAULT_BROWSER_WHISPER_MODEL, device: options.device || 'wasm' } : await loadBrowserWhisper(options);
	abortIfNeeded(options.signal);
	const offset = Math.max(0, options.offsetSeconds || 0);
	const chunkLength = options.chunkLengthSeconds || DEFAULT_WHISPER_WINDOW_SECONDS;
	const stride = options.strideLengthSeconds ?? DEFAULT_WHISPER_STRIDE_SECONDS;
	options.onProgress?.({ phase: 'transcribing', progress: 0, status: '正在转录播放过的音频…' });
	const output = await loaded.transcriber(audio, {
		return_timestamps: true,
		chunk_length_s: chunkLength,
		stride_length_s: stride,
		...(options.language ? { language: options.language } : {}),
		...(options.task ? { task: options.task } : {}),
	});
	abortIfNeeded(options.signal);
	const sourceChunks = output.chunks || (output.text ? [{ timestamp: [0, Math.max(4, audio.length / WHISPER_SAMPLE_RATE)] as [number, number], text: output.text }] : []);
	const chunks: BrowserWhisperChunk[] = [];
	let fallbackStart = 0;
	for (const source of sourceChunks) {
		const normalized = normalizeChunk(source, offset, fallbackStart);
		if (normalized) { chunks.push(normalized); fallbackStart = Math.max(fallbackStart, (normalized.timestamp[1] ?? offset) - offset); }
	}
	options.onProgress?.({ phase: 'transcribing', progress: 1, status: chunks.length ? '转录完成' : '没有识别到语音' });
	return { text: output.text || chunks.map(chunk => chunk.text).join(' '), chunks, model: loaded.model, device: loaded.device, segments: chunksToPanelSegments(chunks) };
}
