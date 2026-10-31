import { expect, it, vi } from 'vitest';
import { buildDownload, clock, cues, downloadStrings, parseDownloadPref, toMarkdown, toSrt, toVtt, watchDownloadFormat } from './caption-download';

const lines = [
	{ time: '0:05', text: 'Hello there,', start: 5, end: 8.5 },
	{ time: '0:09', text: 'welcome\nback.', start: 9 },
	{ time: '1:02:03', text: 'Much later', chapter: 'Part two' },
];

it('gives every line an end: its own, the next start, or three seconds for the last one', () => {
	expect(cues(lines)).toEqual([{ start: 5, end: 8.5, text: 'Hello there,' }, { start: 9, end: 3723, text: 'welcome\nback.' }, { start: 3723, end: 3726, text: 'Much later' }]);
	// an end that runs past the next line is cut at the next start; a missing or backwards end falls back to it too
	expect(cues([{ time: '0:01', text: 'a', start: 1, end: 9 }, { time: '0:04', text: 'b', start: 4, end: 2 }, { time: '0:06', text: 'c', start: 6 }]).map(cue => cue.end)).toEqual([4, 6, 9]);
	expect(cues([{ time: '0:00', text: '  ' }, { time: '0:02', text: 'x' }])).toHaveLength(1);
});

it('writes SRT with numbered cues and comma milliseconds', () => {
	expect(toSrt(lines)).toBe('1\n00:00:05,000 --> 00:00:08,500\nHello there,\n\n2\n00:00:09,000 --> 01:02:03,000\nwelcome\nback.\n\n3\n01:02:03,000 --> 01:02:06,000\nMuch later');
	expect(clock(3661.0129, ',')).toBe('01:01:01,013'); expect(clock(0.9996, '.')).toBe('00:00:01.000');
});

it('writes VTT with a header, dot milliseconds and escaped markup', () => {
	expect(toVtt(lines).startsWith('WEBVTT\n\n00:00:05.000 --> 00:00:08.500\nHello there,\n\n')).toBe(true);
	expect(toVtt([{ time: '0:01', text: 'a <b> & c --> d' }])).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\na &lt;b> &amp; c --&gt; d');
});

it('writes Markdown with the title, the source, chapters as headings and "[mm:ss] text" lines', () => {
	expect(toMarkdown(lines, { title: 'My video - YouTube', url: 'https://youtu.be/x' })).toBe('# My video\n\n<https://youtu.be/x>\n\n- [0:05] Hello there,\n- [0:09] welcome back.\n\n## Part two\n\n- [1:02:03] Much later');
	expect(toMarkdown([lines[0]])).toBe('- [0:05] Hello there,');
});

it('names the file after the title with the format extension and sets a matching type', () => {
	expect(buildDownload('srt', lines, { title: 'A/B: C - YouTube' })).toMatchObject({ filename: 'A B C.srt', mime: 'application/x-subrip;charset=utf-8' });
	expect(buildDownload('md', lines, { title: 'T', url: 'u' })).toMatchObject({ filename: 'T.md', mime: 'text/markdown;charset=utf-8' });
	expect(buildDownload('vtt', lines, { title: 'T' }).mime).toBe('text/vtt;charset=utf-8');
	expect(buildDownload('txt', lines, { title: '' })).toEqual({ filename: 'youtube-transcript.txt', mime: 'text/plain;charset=utf-8', content: '[0:05] Hello there,\n[0:09] welcome\nback.\n\n## Part two\n[1:02:03] Much later\n' });
});

it('reads the saved format, ignores anything unknown, and follows changes from the settings page', async () => {
	expect(['md', 'srt', 'vtt', 'txt', 'ask'].map(parseDownloadPref)).toEqual(['md', 'srt', 'vtt', 'txt', 'ask']); expect([undefined, 'pdf', 3].map(parseDownloadPref)).toEqual(['ask', 'ask', 'ask']);
	let listener: (changes: any, area: string) => void = () => {};
	const apply = vi.fn();
	watchDownloadFormat({ storage: { sync: { get: async () => ({ general_settings: { captionDownloadFormat: 'srt' } }) }, onChanged: { addListener: fn => { listener = fn; } } } }, apply);
	await Promise.resolve(); await Promise.resolve(); expect(apply).toHaveBeenLastCalledWith('srt');
	listener({ general_settings: { newValue: { captionDownloadFormat: 'vtt' } } }, 'sync'); expect(apply).toHaveBeenLastCalledWith('vtt');
	listener({ general_settings: { newValue: {} } }, 'sync'); expect(apply).toHaveBeenLastCalledWith('ask');
	listener({ general_settings: { newValue: { captionDownloadFormat: 'md' } } }, 'local'); expect(apply).toHaveBeenCalledTimes(3);
});

it('has user-facing words without jargon', () => {
	const words = downloadStrings((_key, zh) => zh);
	expect(JSON.stringify(words)).not.toMatch(/ASR|helper|协议|助手/); expect(words.fixed).toContain('{format}');
});
