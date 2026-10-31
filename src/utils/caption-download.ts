import { formatSegments, safeFileName, type PanelSegment } from './youtube-panel-actions';

// The formats the transcript bar can download, the setting that fixes one of them, and the conversions.
export type DownloadFormat = 'md' | 'srt' | 'vtt' | 'txt';
export type DownloadPref = 'ask' | DownloadFormat;
export const DOWNLOAD_FORMATS: readonly DownloadFormat[] = ['md', 'srt', 'vtt', 'txt'];
export const DEFAULT_DOWNLOAD_FORMAT: DownloadFormat = 'md';
export const DOWNLOAD_SETTING = 'captionDownloadFormat';
const LAST_CUE_SECONDS = 3;

export const parseDownloadPref = (value: unknown): DownloadPref => (DOWNLOAD_FORMATS as readonly unknown[]).includes(value) ? value as DownloadFormat : 'ask';

export interface DownloadStrings {
	title: string; default: string; done: string; fixed: string; // `fixed` carries {format}
	md: string; mdNote: string; srt: string; srtNote: string; vtt: string; vttNote: string; txt: string; txtNote: string;
}
export const FORMAT_LABELS: Record<DownloadFormat, string> = { md: 'Markdown', srt: 'SRT', vtt: 'VTT', txt: 'TXT' };
export const FORMAT_MIME: Record<DownloadFormat, string> = { md: 'text/markdown', srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain' };

export function downloadStrings(text: (key: string, zh: string, en: string) => string): DownloadStrings {
	return {
		title: text('captionDlTitle', '下载字幕', 'Download subtitles'),
		default: text('captionDlDefault', '默认', 'Default'),
		done: text('captionDlDone', '已下载', 'Downloaded'),
		fixed: text('captionDlFixed', '下载 {format}（右键选其他格式）', 'Download {format} (right-click for other formats)'),
		md: text('captionDlMd', 'Markdown', 'Markdown'), mdNote: text('captionDlMdNote', '带标题和来源，适合放进笔记', 'With title and source, for notes'),
		srt: text('captionDlSrt', 'SRT 字幕', 'SRT subtitles'), srtNote: text('captionDlSrtNote', '带时间轴，可直接放进播放器', 'Timed, ready for a video player'),
		vtt: text('captionDlVtt', 'VTT 字幕', 'VTT subtitles'), vttNote: text('captionDlVttNote', '带时间轴，网页播放器通用', 'Timed, works in web players'),
		txt: text('captionDlTxt', '纯文本', 'Plain text'), txtNote: text('captionDlTxtNote', '每行一句，带时间', 'One line each, with the time'),
	};
}

const toSeconds = (stamp: string) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);

// Start and end of every line. A line without an end (or an end that runs into the next line) stops where the next
// one starts; the last line without an end gets a few seconds.
export function cues(segments: PanelSegment[]): Array<{ start: number; end: number; text: string }> {
	const starts = segments.map(segment => { const value = segment.start ?? toSeconds(segment.time); return Number.isFinite(value) ? Math.max(0, value) : 0; });
	return segments.map((segment, index) => {
		const start = starts[index], next = starts[index + 1];
		let end = segment.end !== undefined && Number.isFinite(segment.end) && segment.end > start ? segment.end : undefined;
		if (next !== undefined && next > start) end = end === undefined ? next : Math.min(end, next);
		return { start, end: end ?? start + LAST_CUE_SECONDS, text: segment.text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).join('\n') };
	}).filter(cue => cue.text);
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
export function clock(totalSeconds: number, separator: ',' | '.'): string {
	const whole = Math.round(totalSeconds * 1000);
	return `${pad(Math.floor(whole / 3600000))}:${pad(Math.floor(whole / 60000) % 60)}:${pad(Math.floor(whole / 1000) % 60)}${separator}${pad(whole % 1000, 3)}`;
}

export const toSrt = (segments: PanelSegment[]): string => cues(segments).map((cue, index) => `${index + 1}\n${clock(cue.start, ',')} --> ${clock(cue.end, ',')}\n${cue.text}`).join('\n\n');
// A cue text may not contain the arrow, and VTT reads "&" and "<" as markup.
const vttText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '--&gt;');
export const toVtt = (segments: PanelSegment[]): string => `WEBVTT\n\n${cues(segments).map(cue => `${clock(cue.start, '.')} --> ${clock(cue.end, '.')}\n${vttText(cue.text)}`).join('\n\n')}`;

const cleanTitle = (title: string) => title.replace(/\s*[-–|]\s*(YouTube|哔哩哔哩|bilibili)\s*$/i, '').replace(/\s+/g, ' ').trim();
// Title, the page it came from, then the lines as a list in the same "[mm:ss] text" form as copying, with chapters as headings.
export function toMarkdown(segments: PanelSegment[], meta: { title?: string; url?: string } = {}): string {
	const head = [cleanTitle(meta.title || '') ? `# ${cleanTitle(meta.title || '')}` : '', meta.url ? `<${meta.url}>` : ''].filter(Boolean).join('\n\n');
	const body: string[] = [];
	for (const { time, text, chapter } of segments) {
		if (chapter) body.push(`${body.length ? '\n' : ''}## ${chapter}\n`);
		body.push(`- [${time}] ${text.replace(/\s*\n\s*/g, ' ').trim()}`);
	}
	return [head, body.join('\n')].filter(Boolean).join('\n\n').trim();
}

export function buildDownload(format: DownloadFormat, segments: PanelSegment[], meta: { title?: string; url?: string }): { filename: string; content: string; mime: string } {
	const content = format === 'srt' ? toSrt(segments) : format === 'vtt' ? toVtt(segments) : format === 'md' ? toMarkdown(segments, meta) : formatSegments(segments);
	return { filename: `${safeFileName(meta.title || '')}.${format}`, content: `${content}\n`, mime: `${FORMAT_MIME[format]};charset=utf-8` };
}

// Keeps `apply` in step with the "subtitle download format" setting, on load and whenever the settings page changes it.
type SettingsApi = { storage: { sync?: { get(key: string): Promise<Record<string, any>> }; onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void } } };
export function watchDownloadFormat(api: SettingsApi, apply: (pref: DownloadPref) => void): void {
	api.storage.sync?.get('general_settings').then(data => apply(parseDownloadPref(data?.general_settings?.[DOWNLOAD_SETTING]))).catch(() => {});
	api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(parseDownloadPref(changes.general_settings.newValue?.[DOWNLOAD_SETTING])); });
}
