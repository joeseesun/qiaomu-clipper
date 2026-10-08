import type { GenerationActions, GenerationStrings, GenUi } from './subtitle-generation-panel';

// The one decision before subtitles are made, as a dialog: which way to recognise, in what language, and whether to start straight
// away next time. It sits above the page (not inside the transcript bar or the study page), so it looks the same everywhere and
// never has to fit the space it was opened from. All of its colours are its own: it follows the light or dark setting of the page.
type Confirm = Extract<GenUi, { kind: 'confirm' }>;
export const LANGUAGES: Array<[string, string]> = [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano']];
const sizeText = (mb: number) => mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB';

export function buildConfirmDialog(doc: Document, strings: GenerationStrings, actions: GenerationActions, ui: Confirm, state: { language: string; remember?: boolean }, close: () => void): HTMLElement {
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	const wrap = make('div', 'qiaomu-dlg-wrap'); wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
	const scrim = make('div', 'qiaomu-dlg-scrim'), card = make('div', 'qiaomu-dlg'), title = make('h2', 'qiaomu-dlg-title', strings.dlgTitle); title.id = 'qiaomu-dlg-title'; wrap.setAttribute('aria-labelledby', title.id);
	card.append(title, make('p', 'qiaomu-dlg-sub', ui.install ? strings.confirmInstall.replace('{name}', ui.install.name).replace('{size}', sizeText(ui.install.sizeMb)) : strings.dlgSub));
	let selected = ui.selected;
	const choices = ui.choices ?? [], rows: HTMLElement[] = [];
	const cloudPicked = () => choices.find(choice => choice.value === selected)?.kind === 'cloud' || (!choices.length && Boolean(ui.cloud) && !ui.localService);
	const primary = make('button', 'qiaomu-dlg-btn is-primary'); primary.type = 'button';
	const labelPrimary = () => { primary.textContent = ui.install ? strings.installStart : cloudPicked() ? strings.startCloud : strings.start; };
	if (choices.length && actions.choose) {
		const group = make('div', 'qiaomu-dlg-choices'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', strings.engineLabel);
		for (const choice of choices) {
			const row = make('div', 'qiaomu-dlg-choice'); row.tabIndex = 0; row.setAttribute('role', 'radio'); row.dataset.value = choice.value; row.dataset.kind = choice.kind ?? 'local';
			const body = make('div', 'qiaomu-dlg-choice-text'); body.append(make('b', '', choice.label)); if (choice.note) body.append(make('span', '', choice.note));
			row.append(make('i', 'qiaomu-dlg-radio'), body);
			const pick = () => { if (choice.value === selected) return; selected = choice.value; rows.forEach(item => item.setAttribute('aria-checked', String(item.dataset.value === selected))); labelPrimary(); actions.choose?.(choice.value); };
			row.addEventListener('click', pick); row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
			row.setAttribute('aria-checked', String(choice.value === selected)); rows.push(row); group.append(row);
		}
		card.append(group);
		if (actions.addService) { const add = make('button', 'qiaomu-dlg-link', strings.addService); add.type = 'button'; add.addEventListener('click', () => actions.addService?.()); card.append(add); }
	}
	// Which language is spoken: automatic detection listens to the start, which can mislead (music, a greeting in another language).
	const field = make('div', 'qiaomu-dlg-field'), label = make('label', '', strings.languageLabel), select = make('select', 'qiaomu-dlg-select'); select.id = 'qiaomu-dlg-language'; label.htmlFor = select.id;
	for (const [value, name] of [['auto', strings.languageAuto], ...LANGUAGES]) { const option = make('option', '', name); option.value = value; select.append(option); }
	select.value = state.language; select.addEventListener('change', () => { state.language = select.value; });
	field.append(label, select); card.append(field);
	let remember = state.remember ?? ui.remember !== false;
	if (choices.length) {
		const row = make('div', 'qiaomu-dlg-switchrow'), text = make('div', 'qiaomu-dlg-switchtext'), toggle = make('button', 'qiaomu-dlg-switch'); toggle.type = 'button'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(remember));
		text.append(make('b', '', strings.remember), make('span', '', strings.rememberHint));
		toggle.addEventListener('click', () => { remember = !remember; state.remember = remember; toggle.setAttribute('aria-checked', String(remember)); });
		row.append(text, toggle); card.append(row);
	}
	const foot = make('div', 'qiaomu-dlg-foot'), cancel = make('button', 'qiaomu-dlg-btn', strings.cancel); cancel.type = 'button'; cancel.addEventListener('click', close);
	labelPrimary(); primary.addEventListener('click', () => { if (choices.length) actions.confirm(state.language, remember); else actions.confirm(state.language); });
	foot.append(cancel, primary); card.append(foot);
	scrim.addEventListener('click', close);
	wrap.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
	// A page's own key handlers (a player's space bar, a site's shortcuts) must not see what is typed here.
	for (const type of ['keydown', 'keyup', 'keypress']) card.addEventListener(type, event => event.stopPropagation());
	wrap.append(scrim, card);
	queueMicrotask(() => primary.focus());
	return wrap;
}

export const DIALOG_STYLE = `
.qiaomu-dlg-wrap{--d-fg:#1d1d1f;--d-fg2:#6e6e73;--d-bg:#fff;--d-line:rgba(0,0,0,.1);--d-hover:rgba(0,0,0,.04);--d-field:rgba(0,0,0,.05);--d-accent:#1d1d1f;--d-on-accent:#fff;position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",Roboto,sans-serif;color:var(--d-fg)}
@media (prefers-color-scheme:dark){.qiaomu-dlg-wrap{--d-fg:#f5f5f7;--d-fg2:#a1a1a6;--d-bg:#242426;--d-line:rgba(255,255,255,.14);--d-hover:rgba(255,255,255,.07);--d-field:rgba(255,255,255,.09);--d-accent:#f5f5f7;--d-on-accent:#1d1d1f}}
html[dark] .qiaomu-dlg-wrap,html.theme-dark .qiaomu-dlg-wrap{--d-fg:#f5f5f7;--d-fg2:#a1a1a6;--d-bg:#242426;--d-line:rgba(255,255,255,.14);--d-hover:rgba(255,255,255,.07);--d-field:rgba(255,255,255,.09);--d-accent:#f5f5f7;--d-on-accent:#1d1d1f}
html.theme-light .qiaomu-dlg-wrap{--d-fg:#1d1d1f;--d-fg2:#6e6e73;--d-bg:#fff;--d-line:rgba(0,0,0,.1);--d-hover:rgba(0,0,0,.04);--d-field:rgba(0,0,0,.05);--d-accent:#1d1d1f;--d-on-accent:#fff}
.qiaomu-dlg-wrap *{box-sizing:border-box}
.qiaomu-dlg-wrap svg{mix-blend-mode:normal!important}
.qiaomu-dlg-scrim{position:absolute;inset:0;background:rgba(0,0,0,.38);backdrop-filter:blur(2px);animation:qiaomu-dlg-fade .16s ease-out}
.qiaomu-dlg{position:relative;width:min(460px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:26px 26px 22px;border-radius:18px;background:var(--d-bg);box-shadow:0 24px 64px rgba(0,0,0,.28),0 0 0 1px var(--d-line);animation:qiaomu-dlg-in .18s cubic-bezier(.2,.8,.2,1)}
@keyframes qiaomu-dlg-fade{from{opacity:0}}@keyframes qiaomu-dlg-in{from{opacity:0;transform:translateY(8px) scale(.985)}}
@media (prefers-reduced-motion:reduce){.qiaomu-dlg,.qiaomu-dlg-scrim{animation:none}}
.qiaomu-dlg-title{margin:0 0 4px;font-size:19px;line-height:26px;font-weight:650;letter-spacing:-.01em;color:var(--d-fg)}
.qiaomu-dlg-sub{margin:0 0 18px;color:var(--d-fg2);font-size:13px;line-height:20px}
.qiaomu-dlg-choices{display:flex;flex-direction:column;gap:8px}
.qiaomu-dlg-choice{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--d-line);cursor:pointer;user-select:none;transition:box-shadow .12s,background .12s}
.qiaomu-dlg-choice:hover{background:var(--d-hover)}
.qiaomu-dlg-choice[aria-checked=true]{box-shadow:inset 0 0 0 2px var(--d-accent)}
.qiaomu-dlg-choice:focus-visible{outline:1px solid var(--d-fg2);outline-offset:2px}
.qiaomu-dlg-radio{flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--d-fg2);transition:box-shadow .12s}
.qiaomu-dlg-choice[aria-checked=true] .qiaomu-dlg-radio{box-shadow:inset 0 0 0 5.5px var(--d-accent)}
.qiaomu-dlg-choice-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.qiaomu-dlg-choice-text b{font-size:14px;line-height:20px;font-weight:600;color:var(--d-fg)}
.qiaomu-dlg-choice-text span{font-size:12.5px;line-height:18px;color:var(--d-fg2)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-link{display:inline-block;margin:10px 0 0;padding:4px 2px;border:0;background:none;box-shadow:none;color:var(--d-fg2);font:inherit;font-size:13px;cursor:pointer;width:auto;height:auto}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-link:hover{color:var(--d-fg);text-decoration:underline}
.qiaomu-dlg-field{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding-top:16px;border-top:1px solid var(--d-line)}
.qiaomu-dlg-field label{font-size:14px;font-weight:500;color:var(--d-fg)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-select{appearance:none;-webkit-appearance:none;width:auto;min-width:150px;height:36px;padding:0 34px 0 14px;border:0;border-radius:10px;background:var(--d-field) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 12px center;color:var(--d-fg);font:inherit;font-size:13.5px;cursor:pointer;box-shadow:none;transition:background-color .12s}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-select:hover{background-color:var(--d-hover)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-select:focus-visible{outline:1px solid var(--d-fg2);outline-offset:2px}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-select option{color:#1d1d1f;background:#fff}
.qiaomu-dlg-switchrow{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}
.qiaomu-dlg-switchtext{display:flex;flex-direction:column;gap:1px;min-width:0}
.qiaomu-dlg-switchtext b{font-size:14px;line-height:20px;font-weight:500;color:var(--d-fg)}
.qiaomu-dlg-switchtext span{font-size:12.5px;line-height:18px;color:var(--d-fg2)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-switch{flex:none;position:relative;width:40px;height:24px;padding:0;border:0;border-radius:12px;background:var(--d-field);box-shadow:inset 0 0 0 1px var(--d-line);cursor:pointer;transition:background .15s}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .15s}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-switch[aria-checked=true]{background:var(--d-accent);box-shadow:none}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-switch[aria-checked=true]::after{transform:translateX(16px);background:var(--d-on-accent)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-switch:focus-visible{outline:1px solid var(--d-fg2);outline-offset:2px}
.qiaomu-dlg-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-btn{width:auto;height:40px;padding:0 20px;border:0;border-radius:11px;background:var(--d-field);box-shadow:none;color:var(--d-fg);font:inherit;font-size:14px;font-weight:550;cursor:pointer;transition:background .12s,opacity .12s}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-btn:hover{background:var(--d-hover);box-shadow:inset 0 0 0 1px var(--d-line)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-btn.is-primary{background:var(--d-accent);color:var(--d-on-accent)}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-btn.is-primary:hover{opacity:.88;box-shadow:none}
.qiaomu-dlg-wrap .qiaomu-dlg .qiaomu-dlg-btn:focus-visible{outline:1px solid var(--d-fg2);outline-offset:2px}
@media (max-width:480px){.qiaomu-dlg{padding:22px 18px 18px}.qiaomu-dlg-foot{flex-direction:column-reverse}.qiaomu-dlg-btn{width:100%}}
`;
