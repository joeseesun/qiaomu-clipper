import { createElement, Check, ChevronsUpDown, Plus, Search } from 'lucide';
import type { ModelConfig, Provider } from '../types/types';
import { iconTile } from './provider-catalog';
import { getMessage } from './i18n';

// A searchable, keyboard-friendly model list that replaces a native <select>: models are grouped by provider, the current one is
// set apart by type weight and a check mark (no tinted row, no side bar), and the footer leads to adding another provider.
// Rows are divs and the trigger is scoped in clip-chat.scss, because the app's global button style stretches buttons to full width.

export interface ModelPickerOptions {
	getModels: () => ModelConfig[];
	getProviders: () => Provider[];
	onSelect: (id: string) => void;
	onManage: () => void;
}

export interface ModelPicker {
	trigger: HTMLButtonElement;
	popover: HTMLElement;
	value: string;
	setModels(currentId: string): void;
	open(): void;
	close(): void;
	isOpen(): boolean;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text) element.textContent = text;
	return element;
};
const glyph = (icon: Parameters<typeof createElement>[0]) => createElement(icon);

// Gateways name models "Vendor: Model"; the vendor is already the group, so the list and the button show only the model.
export function shortModelName(name: string): string {
	const match = /^[^:：]{1,28}(?::\s+|：\s*)(\S.*)$/.exec(name.trim());
	return match ? match[1] : name;
}

// Every word typed has to appear in the model name, its id or its provider's name.
export function matchesModel(query: string, model: ModelConfig, provider: Provider | undefined): boolean {
	const haystack = `${model.name} ${model.providerModelId} ${provider?.name || ''}`.toLowerCase();
	return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

export function createModelPicker(options: ModelPickerOptions): ModelPicker {
	const uid = Math.random().toString(36).slice(2, 8);
	const trigger = node('button', 'clip-chat-model');
	trigger.type = 'button';
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	const triggerName = node('span', 'clip-chat-model-name');
	trigger.append(triggerName, glyph(ChevronsUpDown));

	const popover = node('div', 'clip-chat-picker');
	popover.hidden = true;
	const searchRow = node('div', 'clip-chat-picker-search');
	const search = node('input');
	search.type = 'text';
	search.placeholder = getMessage('qiaomuModelSearch');
	search.setAttribute('aria-label', getMessage('qiaomuModelSearch'));
	search.setAttribute('role', 'combobox');
	search.setAttribute('aria-expanded', 'true');
	search.setAttribute('aria-controls', `picker-list-${uid}`);
	search.autocomplete = 'off';
	search.spellcheck = false;
	searchRow.append(glyph(Search), search);
	const list = node('div', 'clip-chat-picker-list');
	list.id = `picker-list-${uid}`;
	list.setAttribute('role', 'listbox');
	const footer = node('div', 'clip-chat-picker-footer');
	const manage = node('button', 'clip-chat-picker-manage');
	manage.type = 'button';
	manage.append(glyph(Plus), node('span', '', getMessage('qiaomuModelManage')));
	footer.append(manage);
	popover.append(searchRow, list, footer);

	let currentId = '';
	let activeIndex = -1;
	let rows: HTMLElement[] = [];
	let rowModels: ModelConfig[] = [];

	const paintActive = () => {
		rows.forEach((row, index) => row.classList.toggle('is-active', index === activeIndex));
		const row = rows[activeIndex];
		if (row) { search.setAttribute('aria-activedescendant', row.id); row.scrollIntoView?.({ block: 'nearest' }); }
		else search.removeAttribute('aria-activedescendant');
	};

	const render = () => {
		const providers = options.getProviders();
		const query = search.value.trim();
		rows = [];
		rowModels = [];
		const children: HTMLElement[] = [];
		for (const provider of providers) {
			const models = options.getModels().filter(m => m.providerId === provider.id && matchesModel(query, m, provider));
			if (!models.length) continue;
			const group = node('div', 'clip-chat-picker-group');
			group.setAttribute('role', 'presentation');
			group.append(iconTile(provider, 'sm'), node('span', 'clip-chat-picker-provider', provider.name));
			if (provider.oauth) group.append(node('span', 'clip-chat-picker-note', getMessage('qiaomuModelPlan')));
			children.push(group);
			for (const model of models) {
				const row = node('div', 'clip-chat-picker-row');
				row.id = `picker-${uid}-${rows.length}`;
				row.setAttribute('role', 'option');
				const selected = model.id === currentId;
				row.setAttribute('aria-selected', String(selected));
				row.classList.toggle('is-current', selected);
				const mark = node('span', 'clip-chat-picker-check');
				if (selected) mark.append(glyph(Check));
				row.append(mark, node('span', 'clip-chat-picker-name', shortModelName(model.name)));
				row.title = model.name === model.providerModelId ? model.name : `${model.name}\n${model.providerModelId}`;
				const index = rows.length;
				row.addEventListener('mousemove', () => { if (activeIndex !== index) { activeIndex = index; paintActive(); } });
				row.addEventListener('click', () => choose(model.id));
				rows.push(row);
				rowModels.push(model);
				children.push(row);
			}
		}
		if (!children.length) children.push(node('div', 'clip-chat-picker-empty', getMessage('qiaomuModelNone')));
		list.replaceChildren(...children);
		const currentRow = rows.findIndex(row => row.classList.contains('is-current'));
		activeIndex = query ? (rows.length ? 0 : -1) : currentRow;
		paintActive();
	};

	const choose = (id: string) => {
		close();
		if (id !== currentId) { picker.setModels(id); options.onSelect(id); }
	};

	function close() {
		if (popover.hidden) return;
		popover.hidden = true;
		trigger.setAttribute('aria-expanded', 'false');
		document.removeEventListener('pointerdown', onOutside, true);
		trigger.focus({ preventScroll: true });
	}
	function onOutside(event: Event) {
		const target = event.target as Node | null;
		if (target && !popover.contains(target) && !trigger.contains(target)) close();
	}
	function open() {
		if (!popover.hidden) return;
		search.value = '';
		popover.hidden = false;
		trigger.setAttribute('aria-expanded', 'true');
		render();
		search.focus({ preventScroll: true });
		document.addEventListener('pointerdown', onOutside, true);
	}

	trigger.addEventListener('click', () => { if (popover.hidden) open(); else close(); });
	search.addEventListener('input', render);
	manage.addEventListener('click', () => { close(); options.onManage(); });
	popover.addEventListener('keydown', event => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
		if (event.isComposing) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!rows.length) return;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			activeIndex = (activeIndex + step + rows.length) % rows.length;
			paintActive();
		} else if (event.key === 'Enter' && event.target === search) {
			event.preventDefault();
			event.stopPropagation();
			const model = rowModels[activeIndex];
			if (model) choose(model.id);
		}
	});

	const picker: ModelPicker = {
		trigger,
		popover,
		get value() { return currentId; },
		set value(id: string) { picker.setModels(id); },
		setModels(id: string) {
			currentId = id;
			const model = options.getModels().find(m => m.id === id);
			triggerName.textContent = model ? shortModelName(model.name) : '';
			trigger.title = model?.name || '';
			trigger.hidden = options.getModels().length === 0;
			if (!popover.hidden) render();
		},
		open,
		close,
		isOpen: () => !popover.hidden
	};
	return picker;
}
