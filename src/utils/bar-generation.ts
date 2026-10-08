import type { PanelSegment } from './youtube-panel-actions';
import type { TranscriptBar } from './youtube-transcript-bar';
import type { GenChoice, GenerationActions, GenUi } from './subtitle-generation-panel';
import { createGeneration, type Generation, type GenerationDeps, type GenerationEvent } from './subtitle-generation';
import { asrChoose, thisBrowser, type AsrStatus, type InstallTarget } from './asr-client';

import browser from './browser-polyfill';
import { t } from './ui-text';
// Connects "generate subtitles" to a page's transcript bar. The page script says how to read the current video key, how to
// put lines into its own transcript store, and where to keep a finished result; this keeps the flow and the bar in step and
// makes sure a job that belongs to another video never paints on this one.
export interface BarGenerationOptions {
	videoKey: () => string | null;
	bar: () => TranscriptBar | undefined;
	// Put the lines (so far, or final) into the page's own transcript for that video.
	apply: (videoKey: string, lines: PanelSegment[], done: boolean) => void;
	// The generation did not produce a transcript (cancelled or failed): the page shows "no subtitles" again.
	revert: (videoKey: string) => void;
	save: (videoKey: string, lines: PanelSegment[]) => void;
	deps?: GenerationDeps;
	choose?: typeof asrChoose;
	// Where "add a cloud service" leads (the settings page); a page that cannot open it leaves this out.
	openSettings?: () => void;
	intervalMs?: number;
}
const sizeText = (mb: number) => mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB';
// Which engine or service is doing the work, in words for the progress line and the note on the result.
export function viaOf(status: AsrStatus): string {
	if (status.mode === 'cloud') return status.cloudLocal ? status.cloudLabel || t('本机服务') : t('{0} · 云端', [status.cloudLabel || t('云端服务')]);
	const engine = (status.local ?? []).find(item => item.id === status.engine) ?? (status.local ?? []).find(item => item.id === status.choices?.engine);
	return engine ? t('{0} · 本机', [engine.name]) : t('本机识别');
}
// What the confirm step shows for a status: the ways to make the subtitles (each with what it costs and where the audio goes), which one is selected, and what would have to be installed first.
export function confirmFor(status: AsrStatus): Extract<GenUi, { kind: 'confirm' }> & { target?: InstallTarget } {
	const cloud = status.mode === 'cloud', locals = (status.local ?? []).filter(item => item.supported);
	const recommended = locals.find(item => item.recommended)?.id ?? locals[0]?.id;
	const chosenLocal = status.choices && status.choices.engine !== 'auto' ? status.choices.engine : (status.engine && status.engine !== 'cloud' ? status.engine : recommended);
	const choices: GenChoice[] = [
		...locals.map(item => ({ value: 'local:' + item.id, kind: 'local' as const, label: item.name, note: item.installed ? t('本机 · 音频不上传 · 免费') : t('本机 · 音频不上传 · 需先下载 {0}', [sizeText(item.sizeMb)]) })),
		...(status.choices?.profiles ?? []).filter(item => item.configured).map(item => ({ value: 'cloud:' + item.id, kind: 'cloud' as const, label: item.label + (item.local ? t('（本机服务）') : ''), note: item.local ? t('本机服务 · 音频不离开这台电脑') : t('云端 · 音频会上传到该服务并按其规则计费') })),
	];
	const picked = cloud ? 'cloud:' + status.choices?.active : 'local:' + chosenLocal;
	// What is missing: the engine the viewer picked (a cloud service needs none), or just the download and audio tools.
	let target: InstallTarget | undefined, install: { name: string; sizeMb: number } | undefined;
	const engine = locals.find(item => item.id === chosenLocal);
	if (!cloud && engine && !engine.installed && engine.managed) { target = engine.id as InstallTarget; install = { name: engine.name, sizeMb: engine.sizeMb + (status.installable?.base ? 60 : 0) }; }
	else if (status.installable?.base && (status.missing.includes('yt-dlp') || status.missing.includes('ffmpeg'))) { target = 'base'; install = { name: t('下载与音频工具（yt-dlp、ffmpeg）'), sizeMb: 60 }; }
	return { kind: 'confirm', modelDownload: status.modelDownloadNeeded, ...(cloud ? { cloud: status.cloudLabel || t('云端服务'), localService: status.cloudLocal === true } : {}), ...(choices.length ? { choices } : {}), ...(choices.some(item => item.value === picked) ? { selected: picked } : {}), ...(install ? { install } : {}), ...(target ? { target } : {}) };
}
const choiceOf = (value: string): { engine: string } | { profile: string } | undefined => { const at = value.indexOf(':'), id = value.slice(at + 1); return at < 0 || !id ? undefined : value.startsWith('cloud:') ? { profile: id } : { engine: id }; };
const LANGUAGE_KEY = 'qiaomuAsrLanguage';
const savedLanguage = (): string => { try { const value = localStorage.getItem(LANGUAGE_KEY); return value && /^[a-z]{2,4}$/.test(value) ? value : 'auto'; } catch { return 'auto'; } };
const rememberLanguage = (value: string) => { try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* storage unavailable */ } };
export interface BarGeneration { actions: GenerationActions; sync: () => void; markGenerated: (videoKey: string) => void; reset: () => void; readonly active: boolean }

// Pressing "generate subtitles" asks only what is still undecided. Once the viewer has chosen an engine or service and agreed to
// start straight away (the "remember" box, or the setting), the press starts the job at once; the confirm step comes back only when
// something has to be installed first, or when the viewer asks to do it another way.
export function createBarGeneration(options: BarGenerationOptions): BarGeneration {
	const uiByKey = new Map<string, GenUi>(); let jobKey = '', lastLanguage = savedLanguage(), pendingTarget: InstallTarget | undefined, selected = '', via = '', force = false, generation: Generation;
	const sync = () => { const key = options.videoKey(); options.bar()?.setGeneration((key && uiByKey.get(key)) || null); };
	const set = (key: string, ui: GenUi | null) => { if (ui) uiByKey.set(key, ui); else uiByKey.delete(key); sync(); };
	const language = () => lastLanguage === 'auto' ? {} : { language: lastLanguage };
	const run = (key: string) => { set(key, { kind: 'running', stage: '', progress: 0, modelDownload: false, via }); generation.run(key, { ...language(), ...(force ? { force: true } : {}) }); };
	const onEvent = (event: GenerationEvent) => {
		const key = jobKey; if (!key) return;
		switch (event.phase) {
			case 'needs-setup': set(key, { kind: 'setup', reason: event.reason, hints: event.hints }); break;
			case 'running': if (!force) options.apply(key, event.segments, false); // when remaking, the existing lines stay until the new ones are done
				 set(key, { kind: 'running', stage: event.stage, progress: event.progress, processedSec: event.processedSec, totalSec: event.totalSec, modelDownload: event.modelDownload, via }); break;
			case 'done': options.apply(key, event.segments, true); options.save(key, event.segments); set(key, { kind: 'generated', ...(via ? { via } : {}) }); break;
			case 'failed': if (!force) options.revert(key); set(key, { kind: 'failed', error: event.error, code: event.code }); break;
			case 'cancelled': if (force) set(key, { kind: 'generated' }); else { options.revert(key); set(key, null); } break;
			case 'installing': set(key, { kind: 'installing', stage: event.stage, progress: event.progress }); break;
			// The install was the only thing standing in the way: carry on and make the subtitles.
			case 'installed': pendingTarget = undefined; run(key); break;
			case 'install-failed': set(key, { kind: 'failed', error: event.error, code: 'install' }); break;
			case 'install-cancelled': set(key, null); break;
		}
	};
	generation = createGeneration(onEvent, options.deps, options.intervalMs);
	const request = (ask = false) => {
		const key = options.videoKey(); if (!key) return; jobKey = key; set(key, { kind: 'checking' });
		void generation.prepare(key).then(status => {
			if (jobKey !== key || !status) return;
			const { target, ...ui } = confirmFor(status); pendingTarget = target; selected = ui.selected ?? ''; via = viaOf(status);
			if (!ask && status.choices?.auto && status.ready && !target) { run(key); return; }
			set(key, ui);
		});
	};
	const remember = (value: boolean) => { const choice = choiceOf(selected); if (choice) void (options.choose ?? asrChoose)({ ...choice, auto: value, ...(options.videoKey() ? { videoKey: options.videoKey()! } : {}) }); };
	return {
		get active() { return generation.active; },
		sync,
		markGenerated: key => set(key, { kind: 'generated' }),
		reset() { generation.dispose(); jobKey = ''; },
		actions: {
			request: () => { force = false; request(); },
			confirm(chosenLanguage, remembered) {
				const key = options.videoKey(); if (!key) return; jobKey = key; lastLanguage = chosenLanguage || 'auto'; rememberLanguage(lastLanguage);
				if (remembered !== undefined) remember(remembered);
				if (pendingTarget) { set(key, { kind: 'installing', stage: '', progress: 0 }); generation.install(pendingTarget); return; }
				run(key);
			},
			// A different engine or service: save it as the default and show the confirm step again for it.
			choose(value) {
				const choice = choiceOf(value); const key = options.videoKey(); if (!key || !choice) return;
				void (options.choose ?? asrChoose)({ ...choice, videoKey: key }).then(() => { if (jobKey === key) request(true); });
			},
			// Make them again another way (different engine or service); the new result replaces the old one.
			regenerate() { force = true; request(true); },
			setup(reason) { if (reason !== 'busy') void browser.runtime.sendMessage({ action: 'openSettings', section: reason === 'helper-offline' || reason === 'helper-outdated' ? 'clip' : 'asr-models' }); },
			addService() { options.openSettings?.(); },
			// The viewer closed the dialog without choosing: back to the plain offer.
			dismiss() { const key = options.videoKey(); if (key) set(key, null); },
			cancel() { generation.cancel(); },
			// The viewer agreed to lend this browser's login for this one download.
			async confirmWithLogin() { const key = options.videoKey(); if (!key) return;
				// Lending the browser's login needs a permission the viewer gives once, in the settings (the local edition already has it).
				const ready = await Promise.resolve(browser.runtime.sendMessage({ action: 'qiaomuCookiesReady' })).then(answer => (answer as { ready?: boolean } | undefined)?.ready === true, () => false);
				if (!ready) { set(key, { kind: 'failed', error: t('要先在设置里允许使用浏览器的登录状态：ASR 语音识别页，打开「下载要验证身份时…」。'), code: 'cookies-permission' }); options.openSettings?.(); return; }
				jobKey = key; set(key, { kind: 'running', stage: '', progress: 0, modelDownload: false, via }); generation.run(key, { cookies: thisBrowser(), ...language() }); },
		},
	};
}
