// Saving the media file of the item being studied (local edition only: nothing here is imported by the store build).
// The file is the one the study player already plays, so it is saved as it is, without converting anything.

export interface DownloadChoice { id: string; label: string; url: string; kind: 'video' | 'audio'; ext: string; bytes?: number }

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

// A readable name that every file system accepts: no path characters, no trailing dots or spaces, a bounded length.
export function downloadFileName(title: string, ext: string, fallback = '乔木剪藏'): string {
	const clean = (title || '').replace(FORBIDDEN, ' ').replace(/#\S+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
	const base = Array.from(clean || fallback).slice(0, 60).join('').trim() || fallback;
	return `${base}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4'}`;
}

// What the file is, judged from its address: podcasts name their audio, the video hosts serve mp4.
export function guessChoice(url: string, video: boolean): { kind: 'video' | 'audio'; ext: string } {
	let path = ''; try { path = new URL(url).pathname.toLowerCase(); } catch { /* keep empty */ }
	const ext = path.match(/\.(mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm)$/)?.[1];
	if (video) return { kind: 'video', ext: ext && /^(mp4|m4v|mov|webm)$/.test(ext) ? ext : 'mp4' };
	return { kind: 'audio', ext: ext && /^(mp3|m4a|aac|wav|flac|ogg|opus)$/.test(ext) ? ext : 'mp3' };
}

// The best-known default: the choice remembered last time if it is still offered, else the first (the best) one.
export function defaultChoice(choices: DownloadChoice[], remembered?: string): DownloadChoice | undefined {
	return choices.find(choice => choice.id === remembered) || choices[0];
}

export function humanSize(bytes: number | undefined): string {
	if (!bytes || bytes <= 0) return '';
	const mb = bytes / 1048576;
	return mb >= 1 ? `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export class DownloadError extends Error { constructor(public code: 'http' | 'network' | 'not-media' | 'cancelled', message: string) { super(message); } }

// Reads the file with progress. `fetcher` is injectable for tests.
export async function fetchMediaBlob(url: string, options: { signal?: AbortSignal; onProgress?: (done: number, total: number | undefined) => void; fetcher?: typeof fetch } = {}): Promise<Blob> {
	const fetcher = options.fetcher ?? fetch;
	let response: Response;
	try { response = await fetcher(url, { signal: options.signal, credentials: 'include' }); }
	catch (error) { if (options.signal?.aborted) throw new DownloadError('cancelled', '已取消'); throw new DownloadError('network', error instanceof Error ? error.message : '网络出错'); }
	if (!response.ok) throw new DownloadError('http', `HTTP ${response.status}`);
	const type = response.headers.get('content-type') || '';
	// A refusal usually comes back as a small web page, not as the file.
	if (/^text\/|json|html/i.test(type)) throw new DownloadError('not-media', '服务器没有返回媒体文件');
	const total = Number(response.headers.get('content-length')) || undefined;
	if (!response.body) { const blob = await response.blob(); options.onProgress?.(blob.size, blob.size); return blob; }
	const reader = response.body.getReader(), parts: Uint8Array[] = []; let done = 0;
	try {
		for (;;) {
			const { value, done: finished } = await reader.read();
			if (finished) break;
			if (value) { parts.push(value); done += value.length; options.onProgress?.(done, total); }
		}
	} catch (error) { if (options.signal?.aborted) throw new DownloadError('cancelled', '已取消'); throw new DownloadError('network', error instanceof Error ? error.message : '下载中断'); }
	return new Blob(parts as BlobPart[], { type: type || 'application/octet-stream' });
}

// The sentence under a failed download: what happened, then what to do.
export function downloadProblem(error: unknown): string {
	if (error instanceof DownloadError) {
		if (error.code === 'cancelled') return '已取消';
		if (error.code === 'http') return error.message === 'HTTP 403' || error.message === 'HTTP 410' ? '没能下载：链接已失效，请回原页面再试' : `没能下载：服务器拒绝了请求（${error.message}）`;
		if (error.code === 'not-media') return '没能下载：服务器没有返回视频文件';
		return '没能下载：网络出错，请重试';
	}
	return '没能下载，请重试';
}
