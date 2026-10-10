import { createElement, Check, ChevronDown, Download } from 'lucide';
import { DownloadChoice, defaultChoice, downloadFileName, downloadProblem, fetchMediaBlob, humanSize, downloadWithNative, revealNativeFile } from './media-download';

import { t } from './ui-text';
// The "download" control under a player (local edition only). One press saves the default file; the arrow lists what else this item
// offers. While it runs the control itself shows the progress, so nothing jumps and no dialog opens.

export interface DownloadButtonOptions {
	title: string;
	choices: DownloadChoice[];
	// Puts the finished file where the person keeps downloads; returns something to reveal it with.
	save(blob: Blob, filename: string): Promise<{ reveal?: () => void } | void>;
	remembered?: string;
	onRemember?(id: string): void;
	fetchBlob?: typeof fetchMediaBlob;
	cookiesTxt?: string;
}
export interface DownloadButton { element: HTMLElement; destroy(): void }

const STYLE_ID = 'qiaomu-dl-style';
const STYLE = `.qiaomu-dl{position:relative;display:inline-flex;align-items:center;font:13px/1.2 var(--font-ui,system-ui,sans-serif);color:var(--text-normal,#222)}
.qiaomu-dl *{box-sizing:border-box}.qiaomu-dl [hidden]{display:none!important}.qiaomu-dl svg{width:15px;height:15px;flex:none;mix-blend-mode:normal!important}
.qiaomu-dl button{width:auto;margin:0;border:0;background:transparent;box-shadow:none;font:inherit;color:inherit;cursor:pointer}
.qiaomu-dl-split{display:inline-flex;height:32px;border-radius:8px;overflow:hidden;background:var(--background-secondary,rgb(128 128 128/12%))}
.qiaomu-dl-split:hover,.qiaomu-dl-split:has([aria-expanded=true]){background:var(--background-modifier-hover,rgb(128 128 128/20%))}
.qiaomu-dl-main{display:inline-flex;align-items:center;gap:6px;height:100%;padding:0 12px}
.qiaomu-dl-more{display:inline-flex;align-items:center;justify-content:center;width:28px;height:100%;padding:0;border-inline-start:1px solid var(--background-modifier-border-hover,rgb(128 128 128/35%))!important;color:var(--text-muted,#6e6e73)}
.qiaomu-dl button:focus-visible{outline:1px solid var(--text-muted,#6e6e73);outline-offset:2px}
.qiaomu-dl-state{display:inline-flex;align-items:center;gap:10px;height:32px;padding:0 6px 0 12px;border-radius:8px;background:var(--background-secondary,rgb(128 128 128/12%))}
.qiaomu-dl-bar{width:96px;height:4px;border-radius:2px;background:var(--background-modifier-border-hover,rgb(128 128 128/35%));overflow:hidden}
.qiaomu-dl-bar>i{display:block;height:100%;width:0;background:var(--text-normal,#222);transition:width .15s}
.qiaomu-dl-link{height:24px;padding:0 8px;border-radius:6px;color:var(--text-muted,#6e6e73)!important}.qiaomu-dl-link:hover{background:var(--background-modifier-hover,rgb(128 128 128/20%));color:var(--text-normal,#222)!important}
.qiaomu-dl-state.is-error{background:var(--background-modifier-error,rgb(220 60 60/12%));color:var(--text-error,#c0392b)}.qiaomu-dl-state.is-error .qiaomu-dl-link{color:inherit!important}
.qiaomu-dl-menu{position:absolute;z-index:30;inset-block-start:calc(100% + 6px);inset-inline-end:0;min-width:220px;padding:6px 0;background:var(--background-primary,#fff);border:1px solid var(--divider-color,var(--background-modifier-border,rgb(128 128 128/35%)));border-radius:12px;box-shadow:0 12px 32px rgb(0 0 0/14%),0 2px 6px rgb(0 0 0/8%)}
.qiaomu-dl-menu[hidden]{display:none}.qiaomu-dl-group{padding:8px 14px 4px;font-size:12px;color:var(--text-muted,#6e6e73)}
.qiaomu-dl-item{display:flex!important;align-items:center;gap:8px;width:100%!important;padding:7px 14px!important;text-align:start}
.qiaomu-dl-item.is-active{background:var(--background-modifier-hover,rgb(128 128 128/10%))}.qiaomu-dl-item.is-current{font-weight:600}
.qiaomu-dl-check{display:inline-flex;width:16px}.qiaomu-dl-size{margin-inline-start:auto;font-size:12px;font-weight:400;color:var(--text-muted,#6e6e73)}
@media (prefers-reduced-motion:reduce){.qiaomu-dl-bar>i{transition:none}}`;

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };
const icon = (i: Parameters<typeof createElement>[0]) => createElement(i) as unknown as SVGElement;

export function mountDownloadButton(host: HTMLElement, options: DownloadButtonOptions): DownloadButton {
	if (!document.getElementById(STYLE_ID)) { const style = node('style'); style.id = STYLE_ID; style.textContent = STYLE; document.head.append(style); }
	const fetchBlob = options.fetchBlob ?? fetchMediaBlob;
	const root = node('div', 'qiaomu-dl'); root.dataset.state = 'idle';
	let current = defaultChoice(options.choices, options.remembered);
	let controller: AbortController | undefined;
	let activeRow = -1; let rows: HTMLButtonElement[] = [];

	const menu = node('div', 'qiaomu-dl-menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
	const main = node('button', 'qiaomu-dl-main'); main.type = 'button';
	const more = node('button', 'qiaomu-dl-more'); more.type = 'button'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', t('选择清晰度或格式')); more.append(icon(ChevronDown));
	const split = node('div', 'qiaomu-dl-split'); split.append(main, more);

	const closeMenu = (focus = false) => { if (menu.hidden) return; menu.hidden = true; more.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); if (focus) more.focus(); };
	function outside(event: Event) { if (!root.contains(event.target as Node)) closeMenu(); }
	const paintActive = () => rows.forEach((row, i) => row.classList.toggle('is-active', i === activeRow));

	const showIdle = () => {
		root.dataset.state = 'idle'; controller = undefined;
		main.replaceChildren(icon(Download), node('span', '', t('下载')));
		main.title = current ? `${current.label}${current.bytes ? ' · ' + humanSize(current.bytes) : ''}` : '';
		split.hidden = !current; more.hidden = options.choices.length < 2;
		root.replaceChildren(split, menu);
	};
	const showState = (kind: 'running' | 'done' | 'error', ...parts: Node[]) => { root.dataset.state = kind; const state = node('div', `qiaomu-dl-state${kind === 'error' ? ' is-error' : ''}`); state.setAttribute('role', 'status'); state.append(...parts); root.replaceChildren(state); };

	const run = async (choice: DownloadChoice) => {
		closeMenu();
		current = choice; options.onRemember?.(choice.id);
		controller = new AbortController();
		const text = node('span', '', t('准备下载…')), bar = node('span', 'qiaomu-dl-bar'), fill = node('i'); bar.append(fill);
		const cancel = node('button', 'qiaomu-dl-link', t('取消')); cancel.type = 'button'; cancel.addEventListener('click', () => controller?.abort());
		showState('running', text, bar, cancel);
		try {
			if (choice.source === 'native') {
				const result = await downloadWithNative(choice, options.title, {
					signal: controller.signal,
					onProgress: (done) => {
						const percent = Math.min(99, Math.floor(done));
						text.textContent = t('正在下载 {0}%', [percent]);
						fill.style.width = `${percent}%`;
					},
					cookiesTxt: options.cookiesTxt,
				});
				text.textContent = t('已保存'); fill.style.width = '100%';
				const link = node('button', 'qiaomu-dl-link', t('在文件夹中显示')); link.type = 'button';
				link.addEventListener('click', () => { void revealNativeFile(result.filePath); });
				const again = node('button', 'qiaomu-dl-link', t('再存一份')); again.type = 'button'; again.addEventListener('click', showIdle);
				showState('done', icon(Check), node('span', '', t('已保存')), link, again);
			} else {
				const blob = await fetchBlob(choice.url, { signal: controller.signal, onProgress: (done, total) => { if (total) { const percent = Math.min(99, Math.floor(done / total * 100)); text.textContent = t('正在下载 {0}%', [percent]); fill.style.width = `${percent}%`; } else text.textContent = t('正在下载 {0}', [humanSize(done)]); } });
				text.textContent = t('正在保存…'); fill.style.width = '100%';
				const saved = await options.save(blob, downloadFileName(options.title, choice.ext));
				const link = node('button', 'qiaomu-dl-link', t('在文件夹中显示')); link.type = 'button';
				link.addEventListener('click', () => saved && saved.reveal?.());
				const again = node('button', 'qiaomu-dl-link', t('再存一份')); again.type = 'button'; again.addEventListener('click', showIdle);
				showState('done', icon(Check), node('span', '', t('已保存')), ...(saved && saved.reveal ? [link] : []), again);
			}
		} catch (error) {
			const message = downloadProblem(error);
			if (message === t('已取消')) { showIdle(); return; }
			const retry = node('button', 'qiaomu-dl-link', t('重试')); retry.type = 'button'; retry.addEventListener('click', () => { void run(choice); });
			const close = node('button', 'qiaomu-dl-link', t('关闭')); close.type = 'button'; close.addEventListener('click', showIdle);
			showState('error', node('span', '', message), retry, close);
		}
	};

	const buildMenu = () => {
		menu.replaceChildren(); rows = [];
		for (const [kind, label] of [['video', t('视频')], ['audio', t('仅音频')]] as const) {
			const group = options.choices.filter(choice => choice.kind === kind); if (!group.length) continue;
			if (options.choices.some(choice => choice.kind !== kind)) menu.append(node('div', 'qiaomu-dl-group', label));
			for (const choice of group) {
				const row = node('button', `qiaomu-dl-item${choice.id === current?.id ? ' is-current' : ''}`); row.type = 'button'; row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', String(choice.id === current?.id));
				const check = node('span', 'qiaomu-dl-check'); if (choice.id === current?.id) check.append(icon(Check));
				row.append(check, node('span', '', choice.label), node('span', 'qiaomu-dl-size', humanSize(choice.bytes)));
				row.addEventListener('click', () => { void run(choice); }); row.addEventListener('mousemove', () => { activeRow = rows.indexOf(row); paintActive(); });
				rows.push(row); menu.append(row);
			}
		}
		activeRow = Math.max(0, rows.findIndex(row => row.classList.contains('is-current'))); paintActive();
	};
	const openMenu = () => { buildMenu(); menu.hidden = false; more.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); rows[activeRow]?.focus(); };

	main.addEventListener('click', () => { if (current) void run(current); });
	more.addEventListener('click', () => { if (menu.hidden) openMenu(); else closeMenu(); });
	menu.addEventListener('keydown', event => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
		else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (rows.length) { activeRow = (activeRow + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; paintActive(); rows[activeRow].focus(); } }
	});
	showIdle(); host.append(root);
	return { element: root, destroy: () => { controller?.abort(); closeMenu(); root.remove(); } };
}
