import { createElement, IconNode } from 'lucide';

type Child = Node | string | null | undefined | false;

// Small element builder; keeps the editor UI free of innerHTML.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === 'class') element.className = String(value);
		else if (key === 'text') element.textContent = String(value);
		else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
		else if (key === 'dataset') Object.assign(element.dataset, value as Record<string, string>);
		else if (value === true) element.setAttribute(key, '');
		else element.setAttribute(key, String(value));
	}
	for (const child of children) if (child) element.append(child);
	return element;
}

export const icon = (node: IconNode, size = 16): SVGElement => {
	const svg = createElement(node) as unknown as SVGElement;
	svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
	svg.setAttribute('aria-hidden', 'true');
	return svg;
};

// A <dialog> asking for one thing. Resolves with the text, or undefined when cancelled.
export interface AskOptions { title: string; value?: string; placeholder?: string; multiline?: boolean; confirm: string; cancel: string; note?: string; mono?: boolean }
export function askText(options: AskOptions): Promise<string | undefined> {
	return new Promise(resolve => {
		const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': options.title });
		const field = options.multiline
			? h('textarea', { class: `qw-field${options.mono ? ' mono' : ''}`, rows: 6, placeholder: options.placeholder ?? '', spellcheck: false })
			: h('input', { class: 'qw-field', type: 'text', placeholder: options.placeholder ?? '', spellcheck: false });
		field.value = options.value ?? '';
		let settled = false;
		const finish = (result: string | undefined) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(result); };
		const ok = h('button', { class: 'qw-btn qw-btn-primary', type: 'button', onclick: () => finish(field.value) }, options.confirm);
		const cancel = h('button', { class: 'qw-btn', type: 'button', onclick: () => finish(undefined) }, options.cancel);
		dialog.append(h('h2', { class: 'qw-dialog-title', text: options.title }), field);
		if (options.note) dialog.append(h('p', { class: 'qw-dialog-note', text: options.note }));
		dialog.append(h('div', { class: 'qw-dialog-actions' }, cancel, ok));
		dialog.addEventListener('cancel', event => { event.preventDefault(); finish(undefined); });
		field.addEventListener('keydown', event => {
			const key = event as KeyboardEvent;
			if (key.isComposing) return;
			if (key.key === 'Enter' && (!options.multiline || key.metaKey || key.ctrlKey)) { key.preventDefault(); finish(field.value); }
		});
		document.body.append(dialog);
		dialog.showModal();
		field.focus(); field.select();
	});
}

export interface ConfirmOptions { title: string; note?: string; confirm: string; cancel: string; danger?: boolean }
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
	return new Promise(resolve => {
		const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': options.title });
		let settled = false;
		const finish = (result: boolean) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(result); };
		const ok = h('button', { class: `qw-btn ${options.danger ? 'qw-btn-danger' : 'qw-btn-primary'}`, type: 'button', onclick: () => finish(true) }, options.confirm);
		const cancel = h('button', { class: 'qw-btn', type: 'button', onclick: () => finish(false) }, options.cancel);
		dialog.append(h('h2', { class: 'qw-dialog-title', text: options.title }));
		if (options.note) dialog.append(h('p', { class: 'qw-dialog-note', text: options.note }));
		dialog.append(h('div', { class: 'qw-dialog-actions' }, cancel, ok));
		dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
		document.body.append(dialog);
		dialog.showModal();
		(options.danger ? cancel : ok).focus();
	});
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
	document.querySelector('.qw-toast')?.remove();
	const node = h('div', { class: `qw-toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
	document.body.append(node);
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => node.remove(), kind === 'error' ? 6000 : 2600);
}
