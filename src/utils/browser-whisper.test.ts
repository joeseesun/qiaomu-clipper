import { describe, expect, it } from 'vitest';
import { chunksToPanelSegments, formatSrt, resampleMono, transcribeBrowserAudio, whisperClock } from './browser-whisper';

describe('browser whisper helpers', () => {
	it('formats reader and SRT timestamps without losing milliseconds', () => {
		expect(whisperClock(0)).toBe('0:00');
		expect(whisperClock(3725.9)).toBe('1:02:05');
		expect(formatSrt([{ timestamp: [1.25, 3.5], text: ' hello  world ' }])).toBe('1\n00:00:01,250 --> 00:00:03,500\nhello world\n');
	});

	it('deduplicates malformed or repeated reader rows', () => {
		expect(chunksToPanelSegments([
			{ timestamp: [2, 3], text: 'First' },
			{ timestamp: [2, 3], text: 'First' },
			{ timestamp: [3, 4], text: '   ' },
			{ timestamp: [5, 6], text: 'Second' },
		])).toEqual([{ time: '0:02', text: 'First' }, { time: '0:05', text: 'Second' }]);
	});

	it('resamples mono audio with a stable endpoint', () => {
		expect(Array.from(resampleMono(new Float32Array([0, 1, 0]), 3, 6))).toEqual([0, 0.5, 1, 0.5, 0, 0]);
	});

	it('maps a captured window to absolute video time and reports progress', async () => {
		const progress: string[] = [];
		const result = await transcribeBrowserAudio(new Float32Array(16_000), {
			offsetSeconds: 120,
			transcriber: async () => ({ text: 'hello', chunks: [{ timestamp: [0.5, 1.5], text: ' hello ' }] }),
			onProgress: value => progress.push(`${value.phase}:${value.progress}`),
		});
		expect(result.segments).toEqual([{ time: '2:00', text: 'hello' }]);
		expect(result.chunks[0].timestamp).toEqual([120.5, 121.5]);
		expect(progress).toEqual(['transcribing:0', 'transcribing:1']);
	});
});
