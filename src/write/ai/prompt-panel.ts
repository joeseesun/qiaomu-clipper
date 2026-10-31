import { Download, FolderInput, Pencil, Plus, Search, Star, Trash2 } from 'lucide';
import { t } from '../../utils/ui-text';
import { askConfirm, h, icon, toast } from '../editor/dom';
import { SOURCE_NAMES, byUsage, isEnabled, matchesPrompt, promptCatalog, type PromptItem, type PromptSettings, type PromptSource } from './prompt-library';
import { MAX_USER_PROMPTS, bumpUsage, exportPrompts, importablePrompts, loadPromptSettings, loadUserPrompts, saveUserPrompts, savePromptSettings, togglePinned } from './prompt-store';
import { fillPrompt, promptFields, usesClipboard, type PromptContext } from './prompt-template';
import type { StarterScene } from './starter-prompts';

export interface PickerOptions {
	anchor: HTMLElement;
	scene: StarterScene;
	context: () => PromptContext;
	// `run` is "send" or "insert": the text goes straight out, or into the composer for the writer to finish.
	onPick: (text: string, run: 'send' | 'insert') => void;
	initialQuery?: string;
	// Run this prompt as soon as the menu opens (the shortcut strip uses it so blanks are asked for in the same place).
	autoRun?: PromptItem;
	onClose?: () => void;
}

type Tab = 'now' | PromptSource | 'all';
const TABS: { id: Tab; label: () => string }[] = [
	{ id: 'now', label: () => t('推荐') }, { id: 'user', label: () => t('我的') }, { id: 'qiaomu', label: () => SOURCE_NAMES.qiaomu }, { id: 'yao', label: () => SOURCE_NAMES.yao }, { id: 'all', label: () => t('全部') },
];

// The prompt menu above the composer (Qiaomu Agent's prompt library): search, scene suggestions, the two curated libraries and
// the writer's own prompts, with blanks to fill in, pinning, and import / export.
export async function openPromptPicker(options: PickerOptions): Promise<{ close: () => void; setQuery: (query: string) => void }> {
	document.querySelector('.qw-prompts')?.remove();
	let userPrompts = await loadUserPrompts();
	let settings: PromptSettings = await loadPromptSettings();
	let tab: Tab = options.initialQuery ? 'all' : 'now';
	let query = options.initialQuery ?? '';
	let form: HTMLElement | null = null;

	const search = h('input', { class: 'qw-field qw-prompts-search', type: 'text', placeholder: t('搜索提示词'), spellcheck: false, 'aria-label': t('搜索提示词') });
	search.value = query;
	const tabs = h('div', { class: 'qw-prompts-tabs', role: 'tablist' });
	const list = h('div', { class: 'qw-prompts-list', role: 'listbox' });
	const foot = h('div', { class: 'qw-prompts-foot' });
	const panel = h('div', { class: 'qw-prompts', role: 'dialog', 'aria-label': t('提示词') }, h('div', { class: 'qw-prompts-head' }, icon(Search, 14), search), tabs, list, foot);
	const host = options.anchor.closest('.qw-chat') ?? document.body;
	host.append(panel);

	const close = () => { panel.remove(); document.removeEventListener('mousedown', away, true); options.onClose?.(); };
	const away = (event: MouseEvent) => { if (!panel.contains(event.target as Node) && !options.anchor.contains(event.target as Node) && !(event.target as HTMLElement).closest?.('dialog')) close(); };
	document.addEventListener('mousedown', away, true);
	panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

	const catalog = () => promptCatalog(userPrompts);
	const visible = (): PromptItem[] => {
		const all = catalog();
		if (query.trim()) return byUsage(all.filter(item => matchesPrompt(item, query)), settings);
		if (tab === 'now') return byUsage(all.filter(item => item.scenes?.includes(options.scene) || (item.source === 'user' && isEnabled(item, settings))), settings);
		if (tab === 'all') return byUsage(all.filter(item => isEnabled(item, settings)), settings);
		return byUsage(all.filter(item => item.source === tab), settings);
	};

	const save = async (next: PromptSettings) => { settings = next; await savePromptSettings(next); draw(); };
	const runPrompt = async (item: PromptItem) => {
		const context = { ...options.context() };
		if (usesClipboard(item.body) && !context.clipboard) { try { context.clipboard = await navigator.clipboard.readText(); } catch { /* the writer can paste it into the form */ } }
		const fields = promptFields(item.body, context);
		const finish = async (values: Record<string, string>) => {
			await save(bumpUsage(settings, item.id));
			const text = fillPrompt(item.body, values, context);
			close();
			options.onPick(text, item.run === 'insert' ? 'insert' : 'send');
		};
		if (!fields.length) { void finish({}); return; }
		form?.remove();
		const values: Record<string, string> = {};
		const inputs = fields.map(field => {
			const control = field.options?.length ? h('select', { class: 'qw-field' }, ...field.options.map(option => h('option', { value: option, text: option }))) : (field.context ? h('textarea', { class: 'qw-field', rows: 3 }) : h('input', { class: 'qw-field', type: 'text' }));
			(control as HTMLInputElement).value = field.defaultValue ?? '';
			if (field.defaultValue === undefined && !field.options?.length) (control as HTMLInputElement).placeholder = field.name;
			return { field, control };
		});
		const go = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: item.run === 'insert' ? t('放进输入框') : t('发送') });
		go.addEventListener('click', () => { for (const { field, control } of inputs) values[field.name] = (control as HTMLInputElement).value; void finish(values); });
		form = h('div', { class: 'qw-prompts-form' }, h('div', { class: 'qw-prompts-form-title', text: item.title }), ...inputs.map(({ field, control }) => h('label', { class: 'qw-prompts-field' }, h('span', { text: field.name }), control)), h('div', { class: 'qw-dialog-actions' }, h('button', { type: 'button', class: 'qw-btn', text: t('返回'), onclick: () => { form?.remove(); form = null; list.hidden = false; tabs.hidden = false; } }), go));
		list.hidden = true; tabs.hidden = true;
		panel.insertBefore(form, foot);
		(inputs[0].control as HTMLElement).focus();
	};

	function editDialog(existing?: PromptItem) {
		const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': t('提示词') });
		const title = h('input', { class: 'qw-field', type: 'text', maxlength: 80, placeholder: t('名字'), spellcheck: false }); title.value = existing?.title ?? '';
		const body = h('textarea', { class: 'qw-field', rows: 8, placeholder: t('提示词内容。可以写 {{主题}} 这样的空白，用 {selection} 引用选中的文字'), spellcheck: false }); body.value = existing?.body ?? '';
		const error = h('p', { class: 'qw-dialog-note im-error', hidden: true });
		const closeDialog = () => { dialog.close(); dialog.remove(); };
		const saveButton = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('保存') });
		saveButton.addEventListener('click', async () => {
			const name = title.value.trim(); const text = body.value.trim();
			if (!name || !text) { error.hidden = false; error.textContent = t('名字和内容都要填'); return; }
			if (!existing && userPrompts.length >= MAX_USER_PROMPTS) { error.hidden = false; error.textContent = t('最多 {0} 条', [MAX_USER_PROMPTS]); return; }
			userPrompts = existing ? userPrompts.map(p => (p.id === existing.id ? { ...p, title: name, body: text } : p)) : [{ id: `u_${Date.now().toString(36)}`, title: name, body: text, source: 'user' }, ...userPrompts];
			await saveUserPrompts(userPrompts); closeDialog(); tab = 'user'; draw();
		});
		dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
		dialog.append(h('h2', { class: 'qw-dialog-title', text: existing ? t('编辑提示词') : t('新建提示词') }), title, h('div', { style: 'height:10px' }), body, error, h('div', { class: 'qw-dialog-actions' }, h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: closeDialog }), saveButton));
		document.body.append(dialog); dialog.showModal(); title.focus();
	}

	function draw() {
		tabs.textContent = '';
		for (const entry of TABS) {
			const b = h('button', { type: 'button', class: `qw-prompts-tab${tab === entry.id && !query.trim() ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === entry.id), text: entry.label() });
			b.addEventListener('click', () => { tab = entry.id; query = ''; search.value = ''; draw(); });
			tabs.append(b);
		}
		list.textContent = '';
		const items = visible();
		if (!items.length) list.append(h('div', { class: 'qw-prompts-empty', text: query.trim() ? t('没有匹配的提示词') : tab === 'user' ? t('还没有自己的提示词，点下面的「新建」') : t('这里还没有可用的提示词') }));
		for (const item of items.slice(0, 120)) {
			const pinned = settings.pinned.includes(item.id);
			const row = h('div', { class: 'qw-prompts-row', role: 'option', tabindex: 0 });
			const text = h('div', { class: 'qw-prompts-text' }, h('div', { class: 'qw-prompts-title', text: item.title }), h('div', { class: 'qw-prompts-snippet', text: item.body.replace(/\s+/g, ' ').slice(0, 90) }), h('div', { class: 'qw-prompts-meta', text: [SOURCE_NAMES[item.source], item.category].filter(Boolean).join(' · ') }));
			const actions = h('div', { class: 'qw-prompts-actions' });
			const mk = (label: string, ic: Node, run: () => void, active = false) => { const b = h('button', { type: 'button', class: `qw-prompts-icon${active ? ' active' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(active) }, ic); b.addEventListener('click', event => { event.stopPropagation(); run(); }); actions.append(b); };
			mk(pinned ? t('从快捷条取消固定') : t('固定到快捷条'), icon(Star, 14), () => void save(togglePinned(settings, item.id)), pinned);
			if (item.source === 'qiaomu' || item.source === 'yao') {
				const on = isEnabled(item, settings);
				const toggle = h('button', { type: 'button', class: `qw-prompts-toggle${on ? ' on' : ''}`, 'aria-pressed': String(on), text: on ? t('已加入常用') : t('加入常用') });
				toggle.addEventListener('click', event => { event.stopPropagation(); void save({ ...settings, enabled: { ...settings.enabled, [item.id]: !on } }); });
				actions.append(toggle);
			}
			if (item.source === 'user') {
				mk(t('编辑'), icon(Pencil, 14), () => editDialog(item));
				mk(t('删除'), icon(Trash2, 14), async () => { if (!(await askConfirm({ title: t('删除这条提示词？'), confirm: t('删除'), cancel: t('取消'), danger: true }))) return; userPrompts = userPrompts.filter(p => p.id !== item.id); await saveUserPrompts(userPrompts); await save({ ...settings, pinned: settings.pinned.filter(id => id !== item.id) }); });
			}
			row.append(text, actions);
			row.addEventListener('click', () => void runPrompt(item));
			row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void runPrompt(item); } });
			list.append(row);
		}
	}

	foot.append(
		h('button', { type: 'button', class: 'qw-prompts-foot-btn', onclick: () => editDialog() }, icon(Plus, 14), t('新建')),
		h('button', { type: 'button', class: 'qw-prompts-foot-btn', onclick: () => {
			const input = h('input', { type: 'file', accept: '.json,application/json' });
			input.addEventListener('change', async () => {
				try {
					const found = importablePrompts(JSON.parse(await input.files![0].text()));
					if (!found.length) { toast(t('文件里没有找到提示词'), 'error'); return; }
					userPrompts = [...found.map((p, i) => ({ id: `u_${Date.now().toString(36)}${i}`, ...p, source: 'user' as const })), ...userPrompts];
					await saveUserPrompts(userPrompts); tab = 'user'; draw(); toast(t('已导入 {0} 条提示词', [found.length]));
				} catch { toast(t('导入失败，文件格式不对'), 'error'); }
			});
			input.click();
		} }, icon(FolderInput, 14), t('导入')),
		h('button', { type: 'button', class: 'qw-prompts-foot-btn', onclick: () => {
			const blob = new Blob([exportPrompts(userPrompts)], { type: 'application/json' });
			const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: 'qiaomu-prompts.json' }); document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
		} }, icon(Download, 14), t('导出我的')),
	);
	search.addEventListener('input', () => { query = search.value; draw(); });
	search.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { (list.querySelector('.qw-prompts-row') as HTMLElement | null)?.click(); } });
	draw();
	if (options.autoRun) void runPrompt(options.autoRun); else search.focus();
	return { close, setQuery: next => { query = next; search.value = next; draw(); } };
}
