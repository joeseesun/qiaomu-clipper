import { createElement, Check, ChevronsUpDown, Plus, Search } from 'lucide';
import type { ModelConfig, Provider } from '../types/types';
import { iconTile } from './provider-catalog';
import { getMessage } from './i18n';
import { getLocalStorage, setLocalStorage, generalSettings } from './storage-utils';
import { effortOptions } from './chat-thinking';
import { reasoningEffortLabel } from './reasoning-label';
import { t } from './ui-text';

const RECENT_KEY = 'qiaomuRecentChatModels';
export function modelEffort(model: ModelConfig): string | undefined {
	try { const saved = localStorage.getItem(`qiaomuWriteEffort:${model.id}`) || ''; return effortOptions({ ...model, providerModelId: model.providerModelId || '' }, generalSettings.providers.find(p => p.id === model.providerId)).includes(saved) ? saved : undefined; } catch { return undefined; }
}

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
	destroy(): void;
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
	const filters = node('div', 'clip-chat-picker-filters');
	const thinking = node('div', 'clip-chat-picker-thinking');
	const thinkingRow = node('div', 'clip-chat-thinking-row', t('思考强度'));
	const effort = node('button', 'clip-chat-effort');
	effort.type = 'button';
	effort.setAttribute('aria-haspopup', 'menu');
	effort.setAttribute('aria-expanded', 'false');
	const effortMenu = node('div', 'clip-chat-effort-menu');
	effortMenu.id = `picker-effort-${uid}`;
	effortMenu.setAttribute('role', 'menu');
	effortMenu.setAttribute('aria-label', t('思考强度'));
	effortMenu.hidden = true;
	effort.setAttribute('aria-controls', effortMenu.id);
	thinkingRow.append(effort); thinking.append(thinkingRow, effortMenu);
	const footer = node('div', 'clip-chat-picker-footer');
	const manage = node('button', 'clip-chat-picker-manage');
	manage.type = 'button';
	manage.append(glyph(Plus), node('span', '', getMessage('qiaomuModelManage')));
	footer.append(manage);
	popover.append(searchRow, filters, list, thinking, footer);

	let currentId = '';
	let activeIndex = -1;
	let rows: HTMLElement[] = [];
	let rowModels: ModelConfig[] = [];
	let recent: string[] = [], filter = '', disposed = false;
	void getLocalStorage(RECENT_KEY).then(value => { if (disposed) return; recent = Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 8) : []; if (!popover.hidden) render(); }).catch(() => {});

	const paintThinking = () => {
		const model = options.getModels().find(m => m.id === currentId), levels = model ? effortOptions({ ...model, providerModelId: model.providerModelId || '' }, options.getProviders().find(p => p.id === model.providerId)) : [];
		thinking.hidden = !levels.length;
		const value = model ? modelEffort(model) || '' : '';
		const label = value ? reasoningEffortLabel(value) : t('自动');
		effort.replaceChildren(node('span', '', label), glyph(ChevronsUpDown));
		effort.setAttribute('aria-label', `${t('思考强度')}：${label}`);
		effortMenu.replaceChildren();
		for (const level of ['', ...levels]) {
			const item = node('button', 'clip-chat-effort-item');
			item.type = 'button'; item.tabIndex = -1;
			item.setAttribute('role', 'menuitemradio');
			item.setAttribute('aria-checked', String(level === value));
			const check = node('span', 'clip-chat-effort-check');
			if (level === value) check.append(glyph(Check));
			item.append(check, node('span', '', level ? reasoningEffortLabel(level) : t('自动')));
			item.onclick = () => {
				try { if (level) localStorage.setItem(`qiaomuWriteEffort:${currentId}`, level); else localStorage.removeItem(`qiaomuWriteEffort:${currentId}`); } catch { /* private mode */ }
				closeEffort(); paintThinking(); effort.focus();
			};
			effortMenu.append(item);
		}
	};
	function closeEffort() { effortMenu.hidden = true; effort.setAttribute('aria-expanded', 'false'); }
	function openEffort(last = false) {
		effortMenu.hidden = false; effort.setAttribute('aria-expanded', 'true');
		const items = Array.from(effortMenu.querySelectorAll('button'));
		(last ? items[items.length - 1] : effortMenu.querySelector<HTMLButtonElement>('[aria-checked=true]') || items[0])?.focus();
	}
	effort.onclick = () => effortMenu.hidden ? openEffort() : closeEffort();
	thinking.addEventListener('keydown', event => {
		event.stopPropagation();
		if (event.key === 'Escape' && !effortMenu.hidden) { event.preventDefault(); closeEffort(); effort.focus(); }
		else if (event.key === 'Escape') { event.preventDefault(); close(); }
		else if (event.key === 'Tab' && !effortMenu.hidden) { closeEffort(); effort.focus(); }
		else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault();
			if (effortMenu.hidden) { openEffort(event.key === 'ArrowUp'); return; }
			const items = Array.from(effortMenu.querySelectorAll('button')), index = items.indexOf(document.activeElement as HTMLButtonElement);
			items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
		}
	});

	const paintActive = () => {
		rows.forEach((row, index) => row.classList.toggle('is-active', index === activeIndex));
		const row = rows[activeIndex];
		if (row) { search.setAttribute('aria-activedescendant', row.id); row.scrollIntoView?.({ block: 'nearest' }); }
		else search.removeAttribute('aria-activedescendant');
	};

	const render = () => {
		const providers = options.getProviders();
		const query = search.value.trim();
		filters.replaceChildren();
		filters.hidden = options.getModels().length <= 12;
		if (!filters.hidden) for (const [id, label] of [['', t('全部')], ['recent', t('最近使用')], ...providers.filter(p => options.getModels().some(m => m.providerId === p.id)).map(p => [p.id, p.name])]) {
			const tab = node('button', '', label); tab.type = 'button'; tab.setAttribute('aria-pressed', String(filter === id));
			tab.onclick = () => { filter = id; render(); }; filters.append(tab);
		}
		rows = [];
		rowModels = [];
		const children: HTMLElement[] = [];
		const groups: { label: string; provider?: Provider; models: ModelConfig[] }[] = [];
		const recentModels = recent.map(id => options.getModels().find(m => m.id === id)).filter((m): m is ModelConfig => !!m).filter(m => matchesModel(query, m, providers.find(p => p.id === m.providerId)));
		if ((!filter || filter === 'recent') && recentModels.length) groups.push({ label: t('最近使用'), models: recentModels });
		if (filter !== 'recent') for (const provider of providers) {
			if (filter && filter !== provider.id) continue;
			const models = options.getModels().filter(m => m.providerId === provider.id && matchesModel(query, m, provider));
			groups.push({ label: provider.name, provider, models });
		}
		for (const { label, provider, models } of groups) {
			if (!models.length) continue;
			const group = node('div', 'clip-chat-picker-group');
			group.setAttribute('role', 'presentation');
			if (provider) group.append(iconTile(provider, 'sm'));
			group.append(node('span', 'clip-chat-picker-provider', label));
			if (provider?.oauth) group.append(node('span', 'clip-chat-picker-note', getMessage('qiaomuModelPlan')));
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
		paintThinking();
	};

	const choose = (id: string) => {
		if (trigger.disabled) return;
		recent = [id, ...recent.filter(item => item !== id)].slice(0, 8);
		void setLocalStorage(RECENT_KEY, recent).catch(() => {});
		close();
		if (id !== currentId) { picker.setModels(id); options.onSelect(id); }
	};

	function close() {
		closeEffort();
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
		if (!popover.hidden || trigger.disabled || disposed) return;
		search.value = '';
		filter = '';
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
		if (event.isComposing || event.target === effort) return;
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
		isOpen: () => !popover.hidden,
		destroy: () => { close(); disposed = true; document.removeEventListener('pointerdown', onOutside, true); }
	};
	return picker;
}
