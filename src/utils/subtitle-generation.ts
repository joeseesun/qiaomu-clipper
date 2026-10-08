import { asrCancel, asrInstall, asrInstallCancel, asrInstallPoll, asrPoll, asrStart, asrStatus, type AsrFailure, type AsrInstall, type AsrJob, type AsrReply, type AsrSegment, type AsrStatus, type CookieBrowser, type InstallTarget } from './asr-client';
import { stampOf } from './bilibili-captions';
import type { PanelSegment } from './youtube-panel-actions';

import { t } from './ui-text';
// Drives one subtitle-generation job for the bar and for study mode: asks the helper to start, polls it, and turns what
// comes back into the transcript lines the rest of the page already understands. The job itself runs in the helper and
// survives leaving the page; coming back to the same video joins it (or reads its cached result).
export type SetupReason = 'missing' | 'helper-offline' | 'helper-outdated' | 'busy' | 'cloud-not-configured';
export type GenerationEvent =
	| { phase: 'needs-setup'; reason: SetupReason; missing: string[]; hints: string[] }
	| { phase: 'running'; stage: string; progress: number; processedSec?: number; totalSec?: number; segments: PanelSegment[]; modelDownload: boolean }
	| { phase: 'done'; segments: PanelSegment[]; language: string | null; cached: boolean }
	| { phase: 'failed'; error: string; code?: string; segments: PanelSegment[] }
	| { phase: 'cancelled'; segments: PanelSegment[] }
	| { phase: 'installing'; stage: string; progress: number }
	| { phase: 'installed' }
	| { phase: 'install-failed'; error: string }
	| { phase: 'install-cancelled' };
export interface GenerationDeps { status: (videoKey?: string) => Promise<AsrReply<AsrStatus>>; start: (videoKey: string, language?: string, force?: boolean, cookies?: CookieBrowser) => Promise<AsrReply<AsrJob>>; poll: (jobId: string, since: number) => Promise<AsrReply<AsrJob>>; cancel: (jobId: string) => Promise<AsrReply<AsrJob>>; install?: (target: InstallTarget) => Promise<AsrReply<AsrInstall>>; installPoll?: (jobId: string) => Promise<AsrReply<AsrInstall>>; installCancel?: (jobId: string) => Promise<AsrReply<AsrInstall>> }
export interface Generation { prepare: (videoKey?: string) => Promise<AsrStatus | undefined>; run: (videoKey: string, options?: { language?: string; cookies?: CookieBrowser; force?: boolean }) => void; install: (target: InstallTarget) => void; cancel: () => void; dispose: () => void; readonly active: boolean }

export const toLines = (segments: AsrSegment[]): PanelSegment[] => segments.map(segment => ({ time: stampOf(segment.start), text: segment.text }));
const SETUP: SetupReason[] = ['helper-offline', 'helper-outdated', 'missing', 'busy', 'cloud-not-configured'];
const MAX_POLL_FAILURES = 4;
// Why an install could not even start, in the viewer's terms.
export function installProblem(failure: AsrFailure): string {
	if (failure.error === 'no-space') return t('磁盘空间不足：需要约 {0} MB，现有 {1} MB', [failure.needMb ?? '?', failure.freeMb ?? '?']);
	if (failure.error === 'busy' || failure.error === 'busy-job') return t('另一个安装或识别任务正在进行，请等它完成后再试');
	if (failure.error === 'unsupported') return failure.message || t('这台电脑不支持这个引擎');
	return failure.message || failure.error;
}

export function createGeneration(onEvent: (event: GenerationEvent) => void, given: GenerationDeps = { status: asrStatus, start: asrStart, poll: asrPoll, cancel: asrCancel }, intervalMs = 1000): Generation {
	const deps = { install: asrInstall, installPoll: asrInstallPoll, installCancel: asrInstallCancel, ...given };
	let token = 0, jobId = '', installId = '', lines: PanelSegment[] = [], running = false;
	const setup = (failure: AsrFailure) => onEvent({ phase: 'needs-setup', reason: (SETUP as string[]).includes(failure.error) ? failure.error as SetupReason : 'helper-offline', missing: failure.missing || [], hints: failure.hints || [] });
	const report = (job: AsrJob) => onEvent({ phase: 'running', stage: job.stage, progress: job.progress, processedSec: job.processedSec ?? undefined, totalSec: job.totalSec ?? undefined, segments: lines, modelDownload: job.state === 'downloadingModel' });
	const finish = (job: AsrJob): boolean => {
		if (job.state === 'completed') onEvent({ phase: 'done', segments: lines, language: job.language ?? null, cached: Boolean(job.cached) });
		else if (job.state === 'failed') onEvent({ phase: 'failed', error: job.error || t('生成字幕失败'), code: job.errorCode ?? undefined, segments: lines });
		else if (job.state === 'cancelled') onEvent({ phase: 'cancelled', segments: lines });
		else return false;
		return true;
	};
	const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
	return {
		get active() { return running; },
		async prepare(videoKey) {
			const status = await deps.status(videoKey);
			if (!status.ok) { setup(status); return undefined; }
			// Not ready is the caller's call when something can be installed: it offers that. Otherwise it is a plain setup problem.
			if (!status.ready && !status.installable?.base && !status.installable?.engines.length) { onEvent({ phase: 'needs-setup', reason: 'missing', missing: status.missing, hints: status.hints }); return undefined; }
			return status;
		},
		run(videoKey, { language = 'auto', cookies, force = false }: { language?: string; cookies?: CookieBrowser; force?: boolean } = {}) {
			const mine = ++token; lines = []; jobId = ''; running = true;
			void (async () => {
				try {
					const started = await (cookies ? deps.start(videoKey, language, force, cookies) : force ? deps.start(videoKey, language, true) : deps.start(videoKey, language));
					if (mine !== token) return;
					if (!started.ok) { if ((SETUP as string[]).includes(started.error)) setup(started); else onEvent({ phase: 'failed', error: started.error, segments: [] }); return; }
					jobId = started.id; lines = toLines(started.segments); let since = started.next, failures = 0;
					if (finish(started)) return;
					report(started);
					for (;;) {
						await sleep(intervalMs);
						if (mine !== token) return;
						const polled = await deps.poll(jobId, since);
						if (mine !== token) return;
						if (!polled.ok) { if (++failures >= MAX_POLL_FAILURES) { onEvent({ phase: 'failed', error: t('与本地助手的连接中断，任务可能仍在后台进行，稍后重新点击即可继续查看'), segments: lines }); return; } continue; }
						failures = 0; lines = lines.concat(toLines(polled.segments)); since = polled.next;
						if (finish(polled)) return;
						report(polled);
					}
				} finally { if (mine === token) running = false; }
			})();
		},
		install(target) {
			const mine = ++token; running = true; installId = '';
			void (async () => {
				try {
					const started = await deps.install(target);
					if (mine !== token) return;
					if (!started.ok) { if (started.error === 'helper-offline' || started.error === 'helper-outdated') setup(started); else onEvent({ phase: 'install-failed', error: installProblem(started) }); return; }
					installId = started.jobId; let polled: AsrInstall = started, failures = 0;
					for (;;) {
						if (polled.state === 'completed') { onEvent({ phase: 'installed' }); return; }
						if (polled.state === 'failed') { onEvent({ phase: 'install-failed', error: polled.error || t('安装失败') }); return; }
						if (polled.state === 'cancelled') { onEvent({ phase: 'install-cancelled' }); return; }
						onEvent({ phase: 'installing', stage: polled.stage, progress: polled.progress });
						for (;;) {
							await sleep(intervalMs);
							if (mine !== token) return;
							const next = await deps.installPoll(installId);
							if (mine !== token) return;
							if (next.ok) { polled = next; failures = 0; break; }
							if (++failures >= MAX_POLL_FAILURES) { onEvent({ phase: 'install-failed', error: t('与本地助手的连接中断，安装可能仍在后台进行，稍后重新点击即可继续查看') }); return; }
						}
					}
				} finally { if (mine === token) running = false; }
			})();
		},
		cancel() {
			const id = jobId, installing = installId; token++; running = false; jobId = ''; installId = '';
			if (installing) { void deps.installCancel(installing).catch(() => {}); onEvent({ phase: 'install-cancelled' }); return; }
			if (id) void deps.cancel(id).catch(() => {}); onEvent({ phase: 'cancelled', segments: lines });
		},
		// Leaving the page stops watching; the job carries on in the helper.
		dispose() { token++; running = false; },
	};
}
