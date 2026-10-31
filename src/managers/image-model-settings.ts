import { ImagePlus, Pencil, RefreshCw, Star, Trash2 } from 'lucide';
import browser from '../utils/browser-polyfill';
import { t } from '../utils/ui-text';
import { askConfirm, h, icon, toast } from '../write/editor/dom';
import { CODEX_IMAGE_MODEL, IMAGE_SOURCES, accountSources, fetchImageModels, imageModelName, isReady, loadImageModels, modelsOf, saveImageModels, serviceName, usesCodexImagegen, type ImageModelConfig, type ImageModelStore, type ImageSource, type ListedModel } from '../write/image-models';
import { newId } from '../write/images';

// "Picture models" in the settings: connect a service once, load every model it offers, and choose which ones can be used for a picture.
export async function initializeImageModelSettings(): Promise<void> {
	const root = document.getElementById('image-models-home');
	if (!root) return;
	let store: ImageModelStore = await loadImageModels();
	const list = h('div', { class: 'im-list', role: 'list' });
	const add = h('button', { type: 'button', class: 'write-btn write-btn-primary' }, icon(ImagePlus, 15), t('添加生图服务'));
	root.append(h('div', { class: 'im-bar' }, add), list, h('p', { class: 'write-note', text: t('密钥只保存在这台电脑的浏览器里，不会同步。生成图片时，你写的描述会发给你选的服务。') }));

	const persist = async () => { await saveImageModels(store); store = await loadImageModels(); render(); };
	const sourceOf = (config: ImageModelConfig): ImageSource | undefined => (config.engine === 'oauth' ? accountSources().find(s => s.providerId === config.providerId) : IMAGE_SOURCES.find(s => s.id === config.sourceId));

	function render() {
		list.textContent = '';
		if (!store.models.length) { list.append(h('div', { class: 'write-empty' }, h('p', { class: 'write-empty-title', text: t('还没有生图服务') }), h('p', { text: t('添加后，可在网页 AI 侧栏、写长文和图库中生成图片。') }))); return; }
		for (const config of store.models) {
			const isDefault = config.id === store.defaultId;
			const buttons = h('div', { class: 'write-row-actions im-actions' });
			const mk = (label: string, ic: Node, run: () => void | Promise<void>, danger = false) => {
				const b = h('button', { type: 'button', class: `write-icon${danger ? ' danger' : ''}`, title: label, 'aria-label': label }, ic);
				b.addEventListener('click', () => { void Promise.resolve(run()); });
				buttons.append(b);
			};
			if (!isDefault) mk(t('设为默认'), icon(Star, 15), async () => { store.defaultId = config.id; await persist(); });
			mk(t('编辑'), icon(Pencil, 15), () => openDialog(config));
			mk(t('删除'), icon(Trash2, 15), async () => {
				if (!(await askConfirm({ title: t('删除这个生图服务？'), note: t('只删除这里保存的设置和密钥。'), confirm: t('删除'), cancel: t('取消'), danger: true }))) return;
				store.models = store.models.filter(m => m.id !== config.id); await persist();
			}, true);
			const models = modelsOf(config);
			list.append(h('div', { class: 'write-row im-row', role: 'listitem' }, h('div', { class: 'write-row-main' },
				h('div', { class: 'write-info' }, h('div', { class: 'write-title' }, serviceName(config), isDefault ? h('span', { class: 'write-badge im-default', text: t('默认') }) : null),
					h('div', { class: 'write-meta' }, h('span', { text: models.length > 1 ? t('{0} 等 {1} 个模型', [config.model, models.length]) : imageModelName(config) }), isReady(config) ? null : h('span', { class: 'im-warn', text: config.engine === 'oauth' ? t('账号已退出登录') : t('还没填完整') })))), buttons));
		}
	}

	function openDialog(existing?: ImageModelConfig): void {
		const accounts = accountSources();
		const all: ImageSource[] = [...accounts, ...IMAGE_SOURCES];
		let source: ImageSource | undefined = existing ? sourceOf(existing) ?? all.find(s => s.id === 'custom') : undefined;
		const dialog = h('dialog', { class: 'qw-dialog im-dialog', 'aria-label': existing ? t('编辑生图服务') : t('添加生图服务') });
		const body = h('div', { class: 'im-body' });
		const selected: string[] = existing ? [...modelsOf(existing)] : [];
		let loaded: ListedModel[] = existing?.catalog && existing.catalog.baseUrl === (existing.baseUrl || source?.baseUrl || '').replace(/\/+$/, '') ? [...existing.catalog.models] : [];
		let request: AbortController | undefined;
		const state = { key: existing?.apiKey ?? '', base: existing?.baseUrl ?? '', name: existing?.name ?? '' };
		const close = () => { request?.abort(); dialog.close(); dialog.remove(); };
		dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
		dialog.append(body);
		document.body.append(dialog);

		const field = (label: string, input: HTMLElement, extra?: HTMLElement | null) => h('label', { class: 'im-field' }, h('span', { text: label }), input, extra);

		function gallery() {
			request?.abort();
			body.textContent = '';
			const groups: { title: string; items: ImageSource[]; hint?: string }[] = [
				{ title: t('账号登录（不用密钥）'), items: [...IMAGE_SOURCES.filter(s => s.engine === 'codex'), ...accounts] },
				{ title: t('云服务商'), items: IMAGE_SOURCES.filter(s => !['custom', 'jimeng', 'codex-local'].includes(s.id)) },
				{ title: t('自定义'), items: IMAGE_SOURCES.filter(s => ['custom', 'jimeng'].includes(s.id)) },
			];
			body.append(h('h2', { class: 'qw-dialog-title', text: t('添加生图服务') }), h('p', { class: 'qw-dialog-note', text: t('先选一个来源，下一步选模型。') }));
			for (const group of groups) {
				body.append(h('div', { class: 'im-group', text: group.title }));
				if (group.hint) { const hint = h('p', { class: 'qw-dialog-note', text: group.hint }); const go = h('a', { href: browser.runtime.getURL('settings.html?section=interpreter'), target: '_blank', text: t('去登录') }); hint.append(' ', go); body.append(hint); }
				const grid = h('div', { class: 'im-sources', role: 'radiogroup', 'aria-label': group.title });
				for (const s of group.items) {
					const card = h('button', { type: 'button', class: 'im-source' }, h('span', { class: 'im-source-name', text: s.id === 'custom' ? t('自定义') : s.name }), h('span', { class: 'im-source-sub', text: s.id === 'custom' ? t('OpenAI 兼容 /images/generations') : s.sub }));
					card.addEventListener('click', () => { if (source !== s) { state.key = ''; state.base = ''; state.name = ''; loaded = []; } source = s; selected.length = 0; selected.push(...s.models.slice(0, 1).map(m => m.id)); form(); });
					grid.append(card);
				}
				body.append(grid);
			}
			body.append(h('div', { class: 'qw-dialog-actions' }, h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: close })));
		}

		function form() {
			const s = source!;
			const isAccount = s.engine === 'oauth' || s.engine === 'codex';
			const builtin = usesCodexImagegen(s);
			if (builtin) selected.splice(0, selected.length, CODEX_IMAGE_MODEL);
			body.textContent = '';
			const key = h('input', { class: 'qw-field', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'API key' }); key.value = state.key;
			const base = h('input', { class: 'qw-field', type: 'text', spellcheck: false, placeholder: s.baseUrl || 'https://…/v1' }); base.value = state.base;
			const name = h('input', { class: 'qw-field', type: 'text', spellcheck: false, placeholder: t('不填就用服务名') }); name.value = state.name;
			const keyLink = s.keyUrl ? h('a', { class: 'im-key-link', href: s.keyUrl, target: '_blank', rel: 'noopener noreferrer', text: t('获取密钥') }) : null;
			const search = h('input', { class: 'qw-field', type: 'text', spellcheck: false, placeholder: t('搜索或直接输入模型名，回车添加') });
			const chips = h('div', { class: 'im-chips' });
			const options = h('div', { class: 'im-models' });
			const status = h('p', { class: 'qw-dialog-note', role: 'status' });
			const error = h('p', { class: 'qw-dialog-note im-error', role: 'alert', hidden: true });

			const drawChips = () => {
				chips.textContent = '';
				if (!selected.length) { chips.append(h('span', { class: 'im-hint', text: t('还没选模型') })); return; }
				selected.forEach((id, index) => {
					const chip = h('span', { class: `im-chip${index === 0 ? ' primary' : ''}` }, h('span', { text: id }));
					if (index > 0) chip.append(h('button', { type: 'button', class: 'im-chip-btn', title: t('设为默认'), 'aria-label': t('设为默认'), text: '★', onclick: () => { selected.splice(index, 1); selected.unshift(id); drawChips(); drawOptions(); } }));
					else chip.append(h('span', { class: 'im-chip-tag', text: t('默认') }));
					chip.append(h('button', { type: 'button', class: 'im-chip-btn', title: t('移除'), 'aria-label': t('移除'), text: '×', onclick: () => { selected.splice(index, 1); drawChips(); drawOptions(); } }));
					chips.append(chip);
				});
			};
			const pool = (): ListedModel[] => { const seen = new Set<string>(); return [...loaded, ...s.models, ...selected.map(id => ({ id }))].filter(m => !seen.has(m.id) && !!seen.add(m.id)); };
			const drawOptions = () => {
				options.textContent = '';
				const q = search.value.trim().toLowerCase();
				for (const m of pool().filter(item => !q || item.id.toLowerCase().includes(q) || (item.name ?? '').toLowerCase().includes(q)).slice(0, 60)) {
					const on = selected.includes(m.id);
					const row = h('button', { type: 'button', class: `im-model${on ? ' on' : ''}`, 'aria-pressed': String(on) }, h('span', { text: m.name ?? m.id }), m.name ? h('span', { class: 'im-hint', text: m.id }) : null);
					row.addEventListener('click', () => { if (on) selected.splice(selected.indexOf(m.id), 1); else selected.push(m.id); drawChips(); drawOptions(); });
					options.append(row);
				}
			};
			search.addEventListener('input', drawOptions);
			search.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); const id = search.value.trim(); if (id && !selected.includes(id)) { selected.push(id); search.value = ''; drawChips(); drawOptions(); } } });
			const load = h('button', { type: 'button', class: 'qw-btn' }, icon(RefreshCw, 14), t('获取可用模型'));
			const invalidate = () => { request?.abort(); loaded = []; status.textContent = ''; state.key = key.value.trim(); state.base = base.value.trim(); drawOptions(); };
			key.addEventListener('input', invalidate); base.addEventListener('input', invalidate);
			name.addEventListener('input', () => { state.name = name.value; });
			load.addEventListener('click', async () => {
				state.key = key.value.trim(); state.base = base.value.trim();
				if (!state.base && !s.baseUrl && !isAccount) { status.textContent = t('自定义服务需要填写接口地址'); return; }
				request?.abort(); const current = new AbortController(); request = current;
				const requestBase = state.base, requestKey = state.key;
				load.disabled = true; status.textContent = t('正在获取…');
				try {
					const got = await fetchImageModels(s, requestBase, requestKey, current.signal);
					if (current.signal.aborted || !dialog.isConnected || source !== s || key.value.trim() !== requestKey || base.value.trim() !== requestBase) return;
					loaded = got;
					status.textContent = got.length ? t('获取到 {0} 个模型，点一下就加入可选', [got.length]) : t('这个服务没有返回模型列表，可以直接输入模型名');
					if (!selected.length && got.length) selected.push(got[0].id);
				} catch (e) { if (!current.signal.aborted && dialog.isConnected) status.textContent = t('没获取到列表（{0}），可以直接输入模型名', [String((e as Error).message).slice(0, 80)]); }
				finally { load.disabled = false; drawChips(); drawOptions(); }
			});

			const save = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('保存') });
			save.addEventListener('click', async () => {
				const primary = selected[0] ?? '';
				const config: ImageModelConfig = { id: existing?.id ?? newId('imm_'), sourceId: s.id, engine: s.engine, name: name.value.trim(), baseUrl: base.value.trim(), apiKey: isAccount ? '' : key.value.trim(), model: primary, models: [...selected], ...(isAccount ? { providerId: s.providerId } : {}), ...(builtin && existing?.agentModel ? { agentModel: existing.agentModel } : {}), ...(!builtin && loaded.length ? { catalog: { baseUrl: (base.value.trim() || s.baseUrl).replace(/\/+$/, ''), models: loaded } } : {}) };
				const problem = !primary ? t('至少选一个模型') : !isAccount && !config.baseUrl && !s.baseUrl ? t('自定义服务需要填写接口地址') : !isAccount && !isReady({ ...config, baseUrl: config.baseUrl || s.baseUrl }) ? t('请填写密钥') : '';
				if (problem) { error.hidden = false; error.textContent = problem; return; }
				store.models = existing ? store.models.map(m => (m.id === existing.id ? config : m)) : [...store.models, config];
				if (!store.defaultId) store.defaultId = config.id;
				close(); await persist(); toast(t('已保存'));
			});
			const back = existing ? null : h('button', { type: 'button', class: 'qw-btn', text: t('返回'), onclick: () => { gallery(); } });
			body.append(h('h2', { class: 'qw-dialog-title', text: existing ? t('编辑生图服务') : t('添加生图服务') }),
				h('p', { class: 'qw-dialog-note', text: `${s.id === 'custom' ? t('自定义') : s.name} · ${s.sub}` }),
				...(isAccount ? s.engine === 'codex' ? [] : [h('p', { class: 'qw-dialog-note', text: t('用这个账号的额度生成图片，不需要密钥。') })] : [field(t('密钥'), key, keyLink)]),
				builtin
					? h('div', { class: 'im-field' }, h('span', { text: t('生图能力') }), h('strong', { text: t('内置 ImageGen') }), h('p', { class: 'qw-dialog-note', text: t('由 Codex 调用内置生图工具，无需选择对话模型。') }))
					: h('div', { class: 'im-field' }, h('span', { text: t('可选用的模型（第一个是默认）') }), chips, search, options, h('div', { class: 'im-load' }, load, status)),
				h('details', { class: 'im-advanced', open: s.id === 'custom' || s.id === 'jimeng' }, h('summary', { text: t('更多设置') }), ...(isAccount ? [] : [field(t('接口地址'), base)]), field(t('显示名称'), name)),
				error, h('div', { class: 'qw-dialog-actions' }, ...(back ? [back] : []), h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: close }), save));
			drawChips(); drawOptions();
		}

		if (source) form(); else gallery();
		dialog.showModal();
	}

	add.addEventListener('click', () => openDialog());
	render();
}
