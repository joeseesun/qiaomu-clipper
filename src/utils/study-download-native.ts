import browser from './browser-polyfill';
import { DownloadError } from './media-download';
import { isDouyinMedia } from './web-page-media';
import { isChannelsMedia } from './channels-study';
import { isXhsMedia } from './xiaohongshu';
import { isXiaoeMedia } from './xiaoe';
import { t } from './ui-text';

type Reply = { ok: boolean; id?: string; state?: string; progress?: number; error?: string };
const ask = async (payload: Record<string, unknown>): Promise<Reply> => {
	let reply: Reply | undefined;
	try { reply = await browser.runtime.sendMessage({ action: 'qiaomuAsr', payload }) as Reply; } catch { /* classified below */ }
	if (!reply?.ok) {
		const error = reply?.error || 'helper-offline';
		throw new DownloadError('helper', error === 'helper-outdated' ? t('本地助手需要更新。安装完成后，回到这里点击「重新检查」。') : error === 'helper-offline' ? t('没连上本地助手') : error === 'busy' ? t('另一个安装或识别任务正在进行，请等它完成后再试') : error === 'missing' ? t('还没有安装下载工具（yt-dlp），请先在「ASR 语音识别」里安装，或运行 brew install yt-dlp。') : error);
	}
	return reply;
};
export async function downloadWithHelper(options: { sourceUrl: string; mediaUrl: string; audioUrl?: string; title: string; video: boolean }, signal: AbortSignal, progress: (done: number, total?: number) => void): Promise<{ reveal: () => void }> {
	const mediaAllowed = (url: string) => isDouyinMedia(options.sourceUrl, url) || isChannelsMedia(options.sourceUrl, url) || isXhsMedia(options.sourceUrl, url) || isXiaoeMedia(options.sourceUrl, url);
	const mediaUrl = mediaAllowed(options.mediaUrl) ? options.mediaUrl : undefined;
	let job: Reply | undefined;
	const cancel = () => { if (job?.id) void ask({ mode: 'downloadCancel', jobId: job.id }).catch(() => {}); };
	signal.addEventListener('abort', cancel, { once: true });
	try {
		if (signal.aborted) throw new DownloadError('cancelled', t('已取消'));
		job = await ask({ mode: 'downloadStart', url: options.sourceUrl, name: options.title, video: options.video, ...(mediaUrl ? { mediaUrl, ...(options.audioUrl && mediaAllowed(options.audioUrl) ? { audioUrl: options.audioUrl } : {}) } : {}) });
		if (!job.id) throw new Error(t('下载中断'));
		while (true) {
			if (signal.aborted) { cancel(); throw new DownloadError('cancelled', t('已取消')); }
			progress(job.progress || 0, 100);
			if (job.state === 'completed') { const id = job.id; return { reveal: () => { void ask({ mode: 'downloadReveal', jobId: id }).catch(() => {}); } }; }
			if (job.state === 'failed') throw new DownloadError('helper', job.error ? t(job.error) : t('下载中断'));
			if (job.state === 'cancelled') throw new DownloadError('cancelled', t('已取消'));
			await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 800); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
			if (!signal.aborted) job = await ask({ mode: 'downloadPoll', jobId: job.id });
		}
	} finally { signal.removeEventListener('abort', cancel); if (job && !['completed', 'failed', 'cancelled'].includes(job.state || '')) cancel(); }
}
