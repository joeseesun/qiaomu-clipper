import browser from './browser-polyfill';

import { t } from './ui-text';
// Subtitle generation for videos without subtitles runs in the local helper (yt-dlp + ffmpeg + Whisper). The browser only
// asks it to start, polls its progress and reads the lines it has produced; audio never passes through the extension.
export interface AsrSegment { start: number; end: number; text: string }
export type AsrState = 'queued' | 'downloading' | 'converting' | 'downloadingModel' | 'transcribing' | 'completed' | 'failed' | 'cancelled';
export interface AsrJob { ok: true; id: string; videoKey: string; state: AsrState; stage: string; progress: number; processedSec?: number | null; totalSec?: number | null; engine?: string | null; language?: string | null; error?: string | null; errorCode?: string | null; cached?: boolean | null; segmentCount?: number | null; segments: AsrSegment[]; next: number }
// A local recognition engine this computer could use: `installed` says whether it is ready now, `managed` whether the helper can install it.
export interface AsrLocalEngine { id: string; name: string; sizeMb: number; note: string; supported: boolean; installed: boolean; modelReady: boolean; managed: boolean; recommended?: boolean }
// What the viewer has chosen, without any key: the background fills this in.
export interface AsrChoices { mode: 'local' | 'cloud'; engine: string; active: string; auto?: boolean; profiles: Array<{ id: string; label: string; local: boolean; configured: boolean }> }
export interface AsrStatus { ok: true; ready: boolean; missing: string[]; hints: string[]; engine: string | null; modelDownloadNeeded: boolean; mode?: 'local' | 'cloud'; cloudLabel?: string; cloudLocal?: boolean; local?: AsrLocalEngine[]; installable?: { base: boolean; engines: string[] }; choices?: AsrChoices }
export type InstallTarget = 'base' | 'mlx' | 'mlx-qwen3' | 'faster-whisper';
export type InstallState = 'queued' | 'installing' | 'downloadingModel' | 'completed' | 'failed' | 'cancelled';
export interface AsrInstall { ok: true; jobId: string; engine: string; state: InstallState; stage: string; progress: number; error?: string | null }
// `error` is a code for the cases the page explains itself, otherwise the helper's own message.
export interface AsrFailure { ok: false; error: string; missing?: string[]; hints?: string[]; jobId?: string; videoKey?: string; installable?: { base: boolean; engines: string[] }; needMb?: number; freeMb?: number; message?: string }
export type AsrReply<T> = T | AsrFailure;

export const ASR_VIDEO_KEY = /^(youtube:[A-Za-z0-9_-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|xiaoyuzhou:[0-9a-f]{24}|file:[0-9a-f]{32}|rss:[0-9a-f]{12}:[0-9a-f]{16}|web:[0-9a-f]{12})$/;
const webRefs = new Map<string, { url: string; mediaUrl?: string }>();
const webCookies = new Map<string, CookieBrowser>();
export const useWebCookies = (key: string, cookies: CookieBrowser) => { webCookies.set(key, cookies); };
export const registerWebSource = (key: string, url: string, mediaUrl?: string) => { webRefs.set(key, { url, ...(mediaUrl ? { mediaUrl } : {}) }); };
// A podcast episode from a feed is named by hash; the address behind a key is remembered here, for the request that starts it.
const feedRefs = new Map<string, { feed: string; guid: string }>();
export const registerFeedEpisode = (key: string, feed: string, guid: string) => { feedRefs.set(key, { feed, guid }); };
export const ASR_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'pt', 'it'];
export const COOKIE_BROWSERS = ['chrome', 'edge', 'brave', 'chromium', 'firefox', 'safari'] as const;
export type CookieBrowser = typeof COOKIE_BROWSERS[number];
// The browser this extension runs in, for the one case where a login is needed and the viewer agreed to lend it.
export const thisBrowser = (): CookieBrowser => /Edg\//.test(navigator.userAgent) ? 'edge' : /Firefox\//.test(navigator.userAgent) ? 'firefox' : 'chrome';
export const isRunning = (state: AsrState) => state !== 'completed' && state !== 'failed' && state !== 'cancelled';

const ask = async <T>(payload: Record<string, unknown>, timeout = 20000): Promise<AsrReply<T>> => {
	try { return await Promise.race([browser.runtime.sendMessage({ action: 'qiaomuAsr', payload }) as Promise<AsrReply<T>>, new Promise<AsrFailure>(resolve => setTimeout(() => resolve({ ok: false, error: 'helper-offline' }), timeout))]); }
	catch { return { ok: false, error: 'helper-offline' }; }
};
// With a video key, the answer is about the way of recognising chosen for that video's site.
export const asrStatus = (videoKey?: string) => ask<AsrStatus>({ mode: 'status', ...(videoKey ? { videoKey } : {}) });
export const asrStart = (videoKey: string, language = 'auto', force = false, cookies?: CookieBrowser) => ask<AsrJob>({ mode: 'start', videoKey, language, force, ...((cookies ?? webCookies.get(videoKey)) ? { cookies: cookies ?? webCookies.get(videoKey) } : {}), ...(feedRefs.has(videoKey) ? { rss: feedRefs.get(videoKey) } : {}), ...(webRefs.has(videoKey) ? { web: webRefs.get(videoKey) } : {}) });
// What yt-dlp can tell about an address: whether it can read it, what it is, and a plain media address when the site gives one.
export interface WebInfo { ok: true; title: string; author: string; seconds: number | null; thumbnail: string | null; site: string; mediaUrl: string | null; video: boolean; audioUrl?: string; description?: string; date?: string | null }
export const asrProbe = (url: string, cookies?: CookieBrowser) => ask<WebInfo>({ mode: 'probe', url, ...(cookies ? { cookies } : {}) }, 65000);
export const asrPoll = (jobId: string, since: number) => ask<AsrJob>({ mode: 'poll', jobId, since });
// Pick how subtitles are made (saved as the default): a local engine, or one of the saved cloud services.
// `auto` also sets whether "generate subtitles" starts at once next time.
export const asrChoose = (choice: ({ engine: string } | { profile: string }) & { auto?: boolean; videoKey?: string }) => ask<AsrStatus>({ mode: 'choose', ...choice });
export const asrInstall = (engine: InstallTarget) => ask<AsrInstall>({ mode: 'install', engine });
export const asrInstallPoll = (jobId: string) => ask<AsrInstall>({ mode: 'installPoll', jobId });
export const asrInstallCancel = (jobId: string) => ask<AsrInstall>({ mode: 'installCancel', jobId });
export const asrUninstall = (engine: string, model: boolean) => ask<{ ok: true; freedMb: number }>({ mode: 'uninstall', engine, model });
// A file the viewer chose is sent to the helper in pieces (a native message is small), and comes back named by its content.
export const UPLOAD_CHUNK = 4 * 1024 * 1024;
export const AUDIO_FILE = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|webm|mp4|mkv|mov|m4v|aiff|amr)$/i;
const base64 = (bytes: Uint8Array): string => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
export async function asrUpload(file: File, onProgress?: (fraction: number) => void, signal?: { cancelled: boolean }): Promise<{ ok: true; key: string } | AsrFailure> {
	const started = await ask<{ ok: true; uploadId: string }>({ mode: 'uploadStart', name: file.name, size: file.size });
	if (!started.ok) return started;
	for (let index = 0, offset = 0; offset < file.size; index++, offset += UPLOAD_CHUNK) {
		if (signal?.cancelled) return { ok: false, error: 'cancelled' };
		const bytes = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer());
		const sent = await ask<{ ok: true }>({ mode: 'uploadChunk', uploadId: started.uploadId, index, data: base64(bytes) });
		if (!sent.ok) return sent;
		onProgress?.(Math.min(1, (offset + bytes.length) / file.size));
	}
	return ask<{ ok: true; key: string }>({ mode: 'uploadFinish', uploadId: started.uploadId });
}
export const asrCancel = (jobId: string) => ask<AsrJob>({ mode: 'cancel', jobId });

// The settings page tries a service with the form's values (a short tone: any answer means the key and model are accepted).
export interface AsrTestResult { ok: boolean; ms?: number; sample?: string; error?: string; code?: string }
const TEST_ERRORS: Record<string, string> = { get 'helper-offline'() { return t('没连上本地助手'); }, get 'helper-outdated'() { return t('本地助手版本较旧。请到「剪藏与保存」更新助手，再重新检查。'); }, get 'bad-request'() { return t('设置不完整或无效'); } };
export const asrTest = async (cloud: Record<string, unknown>, apiKey: string): Promise<AsrTestResult> => {
	const reply = await ask<AsrTestResult>({ mode: 'test', cloud, apiKey }) as AsrTestResult | AsrFailure;
	if ('ok' in reply && reply.ok === true) return reply as AsrTestResult;
	const failure = reply as AsrTestResult & AsrFailure;
	return { ok: false, error: TEST_ERRORS[failure.error ?? ''] || failure.error || t('测试失败'), code: failure.code || (/^helper-(offline|outdated)$/.test(failure.error || '') ? failure.error : undefined) };
};
