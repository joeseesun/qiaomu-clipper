import { stampOf } from './bilibili-captions';
import type { SetupReason } from './subtitle-generation';
import { DIALOG_STYLE, buildConfirmDialog } from './subtitle-generation-dialog';

// The part of the transcript bar that offers, explains and shows the progress of "generate subtitles" for a video that has
// none. It only draws what it is told and reports button presses; the bar and the generation controller do the rest.
// One way to make the subtitles: a local engine or a saved cloud service. `note` says what it costs and where the audio goes.
export interface GenChoice { value: string; label: string; note?: string; kind?: 'local' | 'cloud' }
export type GenUi =
	| { kind: 'offer' }
	| { kind: 'checking' }
	| { kind: 'confirm'; modelDownload: boolean; cloud?: string; localService?: boolean; choices?: GenChoice[]; selected?: string; install?: { name: string; sizeMb: number }; remember?: boolean }
	| { kind: 'installing'; stage: string; progress: number }
	| { kind: 'setup'; reason: SetupReason; hints: string[] }
	| { kind: 'running'; stage: string; progress: number; processedSec?: number; totalSec?: number; modelDownload: boolean; via?: string }
	| { kind: 'failed'; error: string; code?: string }
	| { kind: 'generated'; via?: string };
export interface GenerationStrings {
	offer: string; checking: string; confirm: string; confirmModel: string; start: string; cancel: string; running: string; modelDownloading: string;
	failed: string; retry: string; languageAuto: string; languageLabel: string; needsLogin: string; loginRetry: string; generated: string; setupOffline: string; setupOutdated: string; setupMissing: string; setupBusy: string; setupCloud: string; confirmCloud: string; confirmLocalService: string; copyCommand: string; copied: string; recheck: string; confirmInstall: string; installStart: string; installing: string; installFailed: string; engineLabel: string; dlgTitle: string; dlgSub: string; rememberHint: string; confirmAsk: string; startCloud: string; addService: string; remember: string; regenerate: string; generatedVia: string;
}
export interface GenerationActions { request: () => void; confirm: (language?: string, remember?: boolean) => void; cancel: () => void; confirmWithLogin?: () => void; choose?: (value: string) => void; addService?: () => void; regenerate?: () => void; dismiss?: () => void }
// Language names are written in their own language, so they need no translation.
export const RECOGNITION_LANGUAGES: Array<[string, string]> = [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano']];
export interface GenerationPanel { element: HTMLElement; show: (ui: GenUi | null) => void; kind: () => GenUi['kind'] | null }

export function buildGenerationPanel(doc: Document, strings: GenerationStrings, actions: GenerationActions): GenerationPanel {
	const element = doc.createElement('div'); element.className = 'qiaomu-yt-gen'; element.hidden = true;
	const text = doc.createElement('p'); text.className = 'qiaomu-yt-gen-text'; text.setAttribute('role', 'status');
	const code = doc.createElement('pre'); code.className = 'qiaomu-yt-gen-code'; code.hidden = true;
	const meter = doc.createElement('div'); meter.className = 'qiaomu-yt-gen-meter'; meter.hidden = true; const fill = doc.createElement('i'); meter.append(fill);
	const row = doc.createElement('div'); row.className = 'qiaomu-yt-gen-actions';
	element.append(text, code, meter, row);
	let current: GenUi | null = null, dialog: HTMLElement | undefined; const dialogState: { language: string; remember?: boolean } = { language: 'auto' };
	const button = (label: string, onPress: (button: HTMLButtonElement) => void, primary = false, className = 'qiaomu-yt-gen-button') => {
		const el = doc.createElement('button'); el.type = 'button'; el.className = className + (primary ? ' is-primary' : ''); el.textContent = label;
		// The site's player can swallow clicks; act on the press and ignore the click that follows it.
		let last = 0; const fire = (event: Event) => { event.stopPropagation(); const now = Date.now(); if (now - last < 400) return; last = now; onPress(el); };
		el.addEventListener('pointerup', fire); el.addEventListener('click', fire);
		for (const type of ['pointerdown', 'mousedown', 'touchstart']) el.addEventListener(type, event => event.stopPropagation());
		return el;
	};
	const setupText = (reason: SetupReason) => reason === 'helper-offline' ? strings.setupOffline : reason === 'helper-outdated' ? strings.setupOutdated : reason === 'busy' ? strings.setupBusy : reason === 'cloud-not-configured' ? strings.setupCloud : strings.setupMissing;
	const clock = (seconds?: number) => (seconds === undefined || !Number.isFinite(seconds) ? '' : stampOf(seconds));
	const show = (ui: GenUi | null) => {
		dialog?.remove(); dialog = undefined;
		current = ui; element.hidden = !ui; if (!ui) return;
		element.dataset.kind = ui.kind; code.hidden = true; meter.hidden = true; row.replaceChildren();
		element.querySelectorAll('.qiaomu-yt-gen-choices, .qiaomu-yt-gen-remember').forEach(node => node.remove());
		switch (ui.kind) {
			case 'offer': text.textContent = ''; row.append(button(strings.offer, () => actions.request(), true)); break;
			case 'checking': text.textContent = strings.checking; break;
			case 'confirm': {
				// The decision is a dialog above the page; the inline area stays empty meanwhile.
				element.hidden = true; text.textContent = '';
				const root = element.ownerDocument.body ?? element;
				dialog = buildConfirmDialog(doc, strings, actions, ui, dialogState, () => { actions.dismiss?.(); show({ kind: 'offer' }); }); root.append(dialog);
				break;
			}
			case 'installing': text.textContent = ui.stage ? `${strings.installing}：${ui.stage}` : strings.installing; meter.hidden = false; fill.style.width = Math.max(2, Math.min(100, ui.progress)) + '%'; row.append(button(strings.cancel, () => actions.cancel())); break;
			case 'setup':
				text.textContent = setupText(ui.reason); if (ui.hints.length) { code.hidden = false; code.textContent = ui.hints.join('\n'); }
				if (ui.hints.length) row.append(button(strings.copyCommand, el => { void navigator.clipboard.writeText(ui.hints.join('\n')).then(() => { const old = el.textContent; el.textContent = strings.copied; setTimeout(() => { el.textContent = old; }, 1500); }).catch(() => {}); }));
				row.append(button(strings.recheck, () => actions.request(), !ui.hints.length)); break;
			case 'running': {
				const progressText = ui.modelDownload ? strings.modelDownloading : [strings.running, ui.via ?? '', ui.totalSec ? `${clock(ui.processedSec ?? 0)} / ${clock(ui.totalSec)}` : ''].filter(Boolean).join(' · ');
				text.textContent = progressText; meter.hidden = ui.modelDownload; fill.style.width = Math.max(2, Math.min(100, ui.progress)) + '%';
				row.append(button(strings.cancel, () => actions.cancel())); break;
			}
			case 'failed':
				if (ui.code === 'needs-cookies' && actions.confirmWithLogin) { text.textContent = strings.needsLogin; row.append(button(strings.loginRetry, () => actions.confirmWithLogin?.(), true), button(strings.cancel, () => show({ kind: 'offer' }))); break; }
				text.textContent = `${ui.code === 'install' ? strings.installFailed : strings.failed}${ui.error ? '：' + ui.error : ''}`; row.append(button(strings.retry, () => actions.request(), true)); break;
			case 'generated': text.textContent = ui.via ? strings.generatedVia.replace('{via}', ui.via) : strings.generated; if (actions.regenerate) row.append(button(strings.regenerate, () => actions.regenerate?.())); break;
		}
	};
	return { element, show, kind: () => current?.kind ?? null };
}

export const GENERATION_STYLE = DIALOG_STYLE + `
.qiaomu-yt-gen{display:flex;flex-direction:column;gap:8px;width:100%;margin-top:6px}
.qiaomu-yt-gen[hidden]{display:none}
.qiaomu-yt-gen[data-kind=offer]{width:auto;margin-top:0}
.qiaomu-yt-gen-text{margin:0;color:var(--qm-fg2,var(--text-muted,#666));font-size:12px;line-height:18px}.qiaomu-yt-gen-text:empty{display:none}
.qiaomu-yt-gen-code{margin:0;padding:8px 10px;border-radius:6px;background:var(--qm-field,var(--background-secondary,rgba(127,127,127,.12)));color:var(--qm-fg,var(--text-normal,#222));font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-all;user-select:all}
.qiaomu-yt-gen-code[hidden],.qiaomu-yt-gen-meter[hidden]{display:none}
.qiaomu-yt-gen-meter{height:3px;border-radius:2px;background:var(--qm-field,var(--background-secondary,rgba(127,127,127,.12)));overflow:hidden}
.qiaomu-yt-gen-meter i{display:block;height:100%;background:var(--qm-accent,var(--interactive-accent,#2f6fed));transition:width .4s linear}
.qiaomu-yt-gen-actions{display:flex;flex-wrap:wrap;gap:4px}
.qiaomu-yt-gen-actions:empty{display:none}
.qiaomu-yt-gen-language{height:28px;max-width:140px;padding:0 4px 0 8px;border:0;border-radius:6px;background:var(--qm-field,var(--background-secondary,rgba(127,127,127,.12)));box-shadow:none;color:var(--qm-fg2,var(--text-muted,#666));font:inherit;font-size:12px;cursor:pointer}
.qiaomu-yt-gen-language:focus{outline:none}.qiaomu-yt-gen-language:focus-visible{outline:2px solid var(--qm-accent,var(--interactive-accent,#2f6fed));outline-offset:-2px}
.qiaomu-yt-gen-choices{display:flex;flex-direction:column;gap:6px}
.qiaomu-yt-gen-choice{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 12px;border:1px solid var(--qm-line,rgba(127,127,127,.28));border-radius:8px;background:transparent;box-shadow:none;color:var(--qm-fg,var(--text-normal,#222));font:inherit;text-align:start;cursor:pointer}
.qiaomu-yt-gen-choice i{flex:none;width:14px;height:14px;margin-top:2px;border:1.5px solid var(--qm-fg2,var(--text-muted,#888));border-radius:50%;box-sizing:border-box}
.qiaomu-yt-gen-choice[aria-checked=true]{border-color:var(--qm-accent,var(--interactive-accent,#2f6fed))}
.qiaomu-yt-gen-choice[aria-checked=true] i{border:4px solid var(--qm-accent,var(--interactive-accent,#2f6fed))}
.qiaomu-yt-gen-choice span{display:flex;flex-direction:column;gap:1px;min-width:0}
.qiaomu-yt-gen-choice b{font-size:13px;font-weight:600;line-height:18px}
.qiaomu-yt-gen-choice em{font-size:12px;font-style:normal;line-height:17px;color:var(--qm-fg2,var(--text-muted,#666))}
.qiaomu-yt-gen-choice[data-kind=cloud] em{color:var(--qm-fg2,var(--text-muted,#666))}
.qiaomu-yt-gen-choice:hover{background:var(--qm-hover,var(--background-modifier-hover,rgba(127,127,127,.1)))}
.qiaomu-yt-gen-choice:focus{outline:none}.qiaomu-yt-gen-choice:focus-visible{outline:2px solid var(--qm-accent,var(--interactive-accent,#2f6fed));outline-offset:2px}
.qiaomu-yt-gen-add{align-self:flex-start;height:28px;padding:0 4px;border:0;background:transparent;box-shadow:none;color:var(--qm-fg2,var(--text-muted,#666));font:inherit;font-size:12px;cursor:pointer}
.qiaomu-yt-gen-add:hover{color:var(--qm-accent,var(--interactive-accent,#2f6fed))}
.qiaomu-yt-gen-remember{display:flex;align-items:center;gap:6px;color:var(--qm-fg2,var(--text-muted,#666));font-size:12px;line-height:18px;cursor:pointer}
.qiaomu-yt-gen-remember input{margin:0;accent-color:var(--qm-accent,var(--interactive-accent,#2f6fed))}
/* A real button: a filled shape, not coloured text. Scoped with html + :not() so the app's global button rules (which also style :hover) cannot win. */
html button.qiaomu-yt-gen-button:not(.qg-x){display:inline-flex;align-items:center;justify-content:center;width:auto;flex:0 0 auto;height:32px;padding:0 14px;border:0;border-radius:8px;background:rgba(127,127,127,.16);box-shadow:none;color:var(--qm-fg,var(--text-normal,#1d1d1f));font:inherit;font-size:13px;font-weight:550;line-height:1;white-space:nowrap;cursor:pointer;transition:background .12s,opacity .12s}
html button.qiaomu-yt-gen-button:not(.qg-x):hover{background:rgba(127,127,127,.28);box-shadow:none;color:var(--qm-fg,var(--text-normal,#1d1d1f))}
html button.qiaomu-yt-gen-button.is-primary:not(.qg-x){background:var(--qm-fg,var(--text-normal,#1d1d1f));color:var(--qm-bg,var(--background-primary,#fff))}
html button.qiaomu-yt-gen-button.is-primary:not(.qg-x):hover{background:var(--qm-fg,var(--text-normal,#1d1d1f));color:var(--qm-bg,var(--background-primary,#fff));opacity:.86}
html button.qiaomu-yt-gen-button:not(.qg-x):focus{outline:none}html button.qiaomu-yt-gen-button:not(.qg-x):focus-visible{outline:2px solid var(--qm-fg,var(--text-normal,#1d1d1f));outline-offset:2px}
.qiaomu-yt-gen[data-kind=generated] .qiaomu-yt-gen-text{font-size:11px}
`;
