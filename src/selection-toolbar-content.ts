import { createElement, Languages, Highlighter, WandSparkles, NotebookPen } from 'lucide';
import { captureEnglishSelection, openEnglishLearning, selectionApi, type LearningSelection } from './utils/english-selection';
import { englishText } from './utils/english-ui';

// Top frame only. No dictionary, model, article extraction or network work until a click.
window.dispatchEvent(new Event('qiaomu-selection-dispose'));
const lifetime = new AbortController();
const api = selectionApi();
let selected: LearningSelection | undefined, host: HTMLDivElement | undefined, enabled = true, notes = true, language: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const hide = () => { if (host) host.hidden = true; };
const dispose = () => { lifetime.abort(); clearTimeout(timer); host?.remove(); api.storage.onChanged.removeListener(changed); window.dispatchEvent(new Event('qiaomu-close-learning')); };
const settings = (value: any) => { enabled = value?.selectionToolbar !== false; notes = value?.learningNotes !== false; host?.remove(); host = undefined; };
const changed = (changes: Record<string, any>, area: string) => { if (area === 'sync' && changes.general_settings) settings(changes.general_settings.newValue); if (area === 'local' && changes.language) { language = changes.language.newValue; host?.remove(); host = undefined; } };
api.storage.onChanged.addListener(changed);
void api.storage.sync.get('general_settings').then(data => settings(data.general_settings)).catch(() => {});
void api.storage.local.get('language').then(data => { language = data.language as string; }).catch(() => {});
window.addEventListener('qiaomu-selection-dispose', dispose, { once: true, signal: lifetime.signal });
window.addEventListener('pagehide', hide, { signal: lifetime.signal });
function build() {
	const l = englishText(language);
	host = document.createElement('div'); host.id = 'qiaomu-selection-toolbar'; host.dataset.qiaomuSelectionUi = 'true'; host.hidden = true;
	const root = host.attachShadow({ mode: 'closed' }), css = document.createElement('style');
	css.textContent = ':host{all:initial!important;display:block!important;position:fixed!important;left:var(--qiaomu-toolbar-left,8px)!important;top:var(--qiaomu-toolbar-top,8px)!important;width:max-content!important;max-width:calc(100vw - 16px)!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483646!important}:host([hidden]){display:none!important}div{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;box-sizing:border-box;padding:4px;background:#171717;color:#fff;border-radius:24px;box-shadow:0 3px 12px #0003;font:13px/1.4 system-ui}button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:5px;white-space:nowrap;padding:6px 9px;border-radius:16px;cursor:pointer;color:#fff}button:hover{background:#3b3b3b}button:focus-visible{outline:2px solid #fff;outline-offset:-2px}svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8}';
	const bar = document.createElement('div'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', l('title'));
	const actions = [ ['translate', Languages], ['highlight', Highlighter], ['ask', WandSparkles], ...(notes ? [['note', NotebookPen]] : []) ] as const;
	for (const [action, icon] of actions) {
		const button = document.createElement('button'); button.type = 'button'; button.append(createElement(icon as typeof Languages), document.createTextNode(l(action as 'translate')));
		button.addEventListener('mousedown', e => e.preventDefault());
		button.addEventListener('click', async () => {
			const selection = selected; if (!selection) return;
			hide();
			if (action === 'translate') { void openEnglishLearning(selection, language, button); return; }
			try {
				const current = document.getSelection(); current?.removeAllRanges(); current?.addRange(selection.range);
				const result = await api.runtime.sendMessage({ action: 'qiaomuSelectionAction', command: action, text: selection.input.text }) as { ok?: boolean };
				if (!result?.ok) throw new Error('action');
			} catch { const notice = document.createElement('div'); notice.textContent = l('expired'); notice.setAttribute('role', 'alert'); bar.replaceChildren(notice); host!.hidden = false; }
		});
		bar.append(button);
	}
	root.append(css, bar); document.documentElement.append(host);
}
function update() {
	// Reader owns its own toolbar; never show two toolbars for one selection.
	if (!enabled || document.querySelector('.obsidian-reader-content, .clip-ask-pill')) { hide(); return; }
	selected = captureEnglishSelection();
	if (!selected) { hide(); return; }
	if (!host) build();
	host!.hidden = false;
	const r = selected.rect, { width, height } = host!.getBoundingClientRect();
	host!.style.setProperty('--qiaomu-toolbar-left', `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`, 'important');
	host!.style.setProperty('--qiaomu-toolbar-top', `${r.top > height + 16 ? r.top - height - 8 : Math.max(8, Math.min(innerHeight - height - 8, r.bottom + 8))}px`, 'important');
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 30); };
document.addEventListener('pointerup', e => { if (!host || !e.composedPath().includes(host)) schedule(); }, { signal: lifetime.signal });
document.addEventListener('keyup', e => { if (e.key === 'Shift' || e.shiftKey) schedule(); if (e.key === 'Escape') hide(); }, { signal: lifetime.signal });
document.addEventListener('selectionchange', () => { if (document.getSelection()?.isCollapsed) hide(); }, { signal: lifetime.signal });
document.addEventListener('pointerdown', e => { if (!host || !e.composedPath().includes(host)) hide(); }, { signal: lifetime.signal });
document.addEventListener('scroll', hide, { capture: true, passive: true, signal: lifetime.signal });
window.addEventListener('resize', hide, { signal: lifetime.signal });
