// The two dialogs behind "添加服务商" and "添加模型": a card gallery with brand icons for picking a
// provider, a short form for it, and a searchable list for picking models. Cards and rows are divs:
// the app's global button style stretches buttons to the full width of their container.
import { ModelConfig, OAuthCredentials, Provider } from '../types/types';
import { generalSettings, saveSettings } from '../utils/storage-utils';
import { getMessage } from '../utils/i18n';
import { showModal, hideModal } from '../utils/modal-utils';
import { startSignIn, PendingSignIn } from '../utils/oauth/accounts';
import { fetchProviderModels, ProviderModel } from '../utils/provider-models';
import { CATALOG, CatalogEntry, GROUP_ORDER, ProviderGroup, brandOf, iconTile } from '../utils/provider-catalog';

type Done = () => void;

const t = getMessage;
const GROUP_LABEL: Record<ProviderGroup, string> = { account: 'pdGroupAccount', relay: 'pdGroupRelay', provider: 'pdGroupProvider', local: 'pdGroupLocal' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

// A div that behaves as a button: focusable, Enter and Space activate it.
function press(node: HTMLElement, label: string, run: () => void): HTMLElement {
	node.setAttribute('role', 'button');
	node.tabIndex = 0;
	node.setAttribute('aria-label', label);
	node.addEventListener('click', run);
	node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
	return node;
}

function button(label: string, kind: '' | 'pd-primary' | 'pd-ghost', run: () => void): HTMLButtonElement {
	const b = el('button', kind, label);
	b.type = 'button';
	b.addEventListener('click', run);
	return b;
}

function field(id: string, label: string, input: HTMLInputElement, hint?: Node): HTMLElement {
	const row = el('div', 'pd-field');
	const l = el('label', '', label);
	l.htmlFor = id;
	input.id = id;
	row.append(l, input);
	if (hint) row.append(hint);
	return row;
}

function input(type: string, value = '', placeholder = ''): HTMLInputElement {
	const i = el('input');
	i.type = type;
	i.value = value;
	i.placeholder = placeholder;
	i.spellcheck = false;
	i.autocomplete = 'off';
	return i;
}

interface Dialog { modal: HTMLElement; body: HTMLElement; actions: HTMLElement; close(): void }

function openDialog(id: string, title: string): Dialog {
	const modal = document.getElementById(id) as HTMLElement;
	const body = modal.querySelector('.pd-body') as HTMLElement;
	const actions = modal.querySelector('.pd-actions') as HTMLElement;
	(modal.querySelector('.pd-title') as HTMLElement).textContent = title;
	body.textContent = '';
	actions.textContent = '';
	showModal(modal);
	return { modal, body, actions, close: () => hideModal(modal) };
}

function newId() { return `${Date.now()}${Math.floor(Math.random() * 1000)}`; }

// ---- providers -------------------------------------------------------------------------------

// What the gallery offers: ours first, then anything the upstream list adds that we do not know.
function galleryEntries(extra: Record<string, { id: string; name: string; baseUrl: string; apiKeyUrl?: string; apiKeyRequired?: boolean; modelsList?: string }>): CatalogEntry[] {
	const known = new Set(CATALOG.map(e => e.id));
	const more: CatalogEntry[] = Object.values(extra)
		.filter(p => p && p.id && !known.has(p.id) && !CATALOG.some(e => e.name === p.name) && !/\{(resource-name|deployment-id)\}/.test(p.baseUrl))
		.map(p => ({ id: p.id, name: p.name, group: 'provider' as const, sub: safeHost(p.baseUrl), baseUrl: p.baseUrl, apiKeyUrl: p.apiKeyUrl, apiKeyRequired: p.apiKeyRequired, modelsList: p.modelsList }));
	return [...CATALOG, ...more];
}

function safeHost(url: string): string { try { return new URL(url.replace(/[{}]/g, '')).host; } catch { return ''; } }

export function openProviderPicker(presets: Record<string, any>, done: Done): void {
	const dlg = openDialog('provider-modal', t('pdAddProviderTitle'));
	dlg.modal.classList.add('pd-wide');
	const entries = galleryEntries(presets);
	const added = (e: CatalogEntry) => generalSettings.providers.find(p => p && (p.presetId === e.id || p.name === e.name));

	const search = input('search', '', t('pdSearchProviders'));
	search.className = 'pd-search';
	search.setAttribute('aria-label', t('pdSearchProviders'));
	const grid = el('div', 'pd-gallery');
	dlg.body.append(search, grid);

	const open = (entry: CatalogEntry | null) => showProviderForm(dlg, entry, entry ? added(entry) : undefined, presets, done, () => openProviderPicker(presets, done));

	const card = (entry: CatalogEntry, existing?: Provider) => {
		const c = press(el('div', `pd-card${existing ? ' is-added' : ''}`), entry.name, () => open(entry));
		const text = el('div', 'pd-card-text');
		text.append(el('div', 'pd-card-name', entry.name), el('div', 'pd-card-sub', entry.sub));
		c.append(iconTile({ presetId: entry.id, baseUrl: entry.baseUrl, name: entry.name }, 'lg'), text);
		if (existing) { const ok = el('span', 'pd-card-mark', '✓'); ok.setAttribute('aria-label', t('pdAdded')); c.append(ok); }
		return c;
	};

	const render = () => {
		const q = search.value.trim().toLowerCase();
		grid.textContent = '';
		let count = 0;
		for (const group of GROUP_ORDER) {
			const list = entries.filter(e => e.group === group && (!q || `${e.name} ${e.sub} ${e.id}`.toLowerCase().includes(q)));
			if (!list.length) continue;
			count += list.length;
			grid.append(el('div', 'pd-group', t(GROUP_LABEL[group])));
			const row = el('div', 'pd-cards');
			list.forEach(e => row.append(card(e, added(e))));
			grid.append(row);
		}
		if (!q || t('pdCustomName').toLowerCase().includes(q)) {
			grid.append(el('div', 'pd-group', t('pdGroupCustom')));
			const row = el('div', 'pd-cards');
			const c = press(el('div', 'pd-card is-custom'), t('pdCustomName'), () => open(null));
			const text = el('div', 'pd-card-text');
			text.append(el('div', 'pd-card-name', t('pdCustomName')), el('div', 'pd-card-sub', t('pdCustomSub')));
			c.append(el('span', 'provider-tile is-lg is-plus', '+'), text);
			row.append(c);
			grid.append(row);
			count++;
		}
		if (!count) grid.append(el('div', 'pd-empty', t('pdNoMatch')));
	};
	search.addEventListener('input', render);
	render();
	dlg.actions.append(button(t('cancel'), '', dlg.close));
	search.focus();
}

function showProviderForm(dlg: Dialog, entry: CatalogEntry | null, existing: Provider | undefined, presets: Record<string, any>, done: Done, back: () => void): void {
	dlg.modal.classList.remove('pd-wide');
	dlg.body.textContent = '';
	dlg.actions.textContent = '';
	const title = dlg.modal.querySelector('.pd-title') as HTMLElement;
	title.textContent = existing ? t('pdEditProviderTitle') : t('pdAddProviderTitle');

	let oauth: OAuthCredentials | undefined = existing?.oauth;
	let pending: PendingSignIn | undefined;
	const head = el('div', 'pd-head');
	const preview = { presetId: entry?.id, baseUrl: existing?.baseUrl || entry?.baseUrl || '', name: existing?.name || entry?.name || '' };
	head.append(iconTile(preview, 'lg'));
	const nameInput = input('text', existing?.name || '', t('pdFieldNamePlaceholder'));
	if (entry) head.append(el('strong', '', entry.name)); else head.append(nameInput);
	dlg.body.append(head);

	const note = el('div', 'pd-note');
	const signIn = entry?.signIn;
	const status = el('div', 'pd-status');
	status.setAttribute('role', 'status');
	const keyInput = input('password', existing?.apiKey || '', 'sk-…');
	const urlInput = input('text', existing?.baseUrl || entry?.baseUrl || '', 'https://');
	let signInBtn: HTMLButtonElement | undefined;

	const setSignedIn = (label: string) => { status.textContent = t('providerSignInDone', label); status.classList.remove('is-error'); if (signInBtn) signInBtn.textContent = t('providerSignInAgain'); };
	const run = async () => {
		if (!signIn || !signInBtn) return;
		pending?.handle.cancel();
		signInBtn.disabled = true;
		status.classList.remove('is-error');
		status.textContent = t('providerSignInOpen');
		paste.hidden = false;
		try {
			pending = await startSignIn(signIn);
			const result = await pending.finish();
			if (result.apiKey) { keyInput.value = result.apiKey; oauth = undefined; }
			if (result.oauth) { oauth = result.oauth; keyInput.value = ''; }
			setSignedIn(result.label);
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : String(error);
			status.classList.add('is-error');
			signInBtn.textContent = t('providerSignInAgain');
		} finally {
			signInBtn.disabled = false;
			paste.hidden = true;
			pending = undefined;
		}
	};

	const paste = el('div', 'pd-paste');
	paste.hidden = true;
	const pasteInput = input('text', '', t('providerSignInPaste'));
	paste.append(pasteInput, button(t('providerSignInPasteButton'), '', () => {
		if (pending && !pending.handle.submitUrl(pasteInput.value)) { status.textContent = t('pdPasteWrong'); status.classList.add('is-error'); }
	}));

	if (signIn === 'chatgpt' || signIn === 'codex') {
		note.textContent = t(signIn === 'codex' ? 'providerSignInNoteCodex' : 'providerSignInNoteChatGPT');
		signInBtn = button(t(signIn === 'codex' ? 'providerSignInCodex' : 'providerSignInChatGPT'), 'pd-primary', () => { void run(); });
		const row = el('div', 'pd-signin');
		row.append(signInBtn);
		dlg.body.append(note, row, status, paste);
		if (oauth && oauth.kind === signIn) setSignedIn(oauth.email || entry!.name);
	} else {
		if (signIn === 'tokendance') {
			note.textContent = t('providerSignInNoteTokenDance');
			signInBtn = button(t('providerSignInTokenDance'), 'pd-primary', () => { void run(); });
			const row = el('div', 'pd-signin');
			row.append(signInBtn);
			dlg.body.append(note, row, status, paste);
		} else if (entry) {
			note.textContent = entry.group === 'local' ? t('pdLocalNote') : '';
			if (note.textContent) dlg.body.append(note);
		}
		const keyHint = el('div', 'pd-hint');
		if (entry?.apiKeyUrl) {
			const a = el('a', '', t('pdGetKey'));
			a.href = entry.apiKeyUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
			keyHint.append(a);
		}
		if (!entry) dlg.body.append(field('pd-url', t('pdFieldUrl'), urlInput, el('div', 'pd-hint', t('pdUrlHintCustom'))));
		if (!entry || entry.apiKeyRequired !== false || signIn === 'tokendance') {
			const keyRow = field('pd-key', signIn === 'tokendance' ? t('pdFieldKeyOr') : t('pdFieldKey'), keyInput, keyHint);
			const reveal = press(el('span', 'pd-reveal', t('pdShow')), t('pdShow'), () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; reveal.textContent = keyInput.type === 'password' ? t('pdShow') : t('pdHide'); });
			const wrap = el('div', 'pd-input-wrap');
			keyInput.replaceWith(wrap);
			wrap.append(keyInput, reveal);
			keyRow.classList.add('has-reveal');
			dlg.body.append(keyRow);
		}
		if (entry && entry.group !== 'local') {
			const more = el('details', 'pd-more');
			more.append(el('summary', '', t('pdAdvanced')));
			more.append(field('pd-url', t('pdFieldUrl'), urlInput, el('div', 'pd-hint', t('pdUrlHint'))));
			dlg.body.append(more);
		} else if (entry) {
			dlg.body.append(field('pd-url', t('pdFieldUrl'), urlInput));
		}
	}
	const error = el('div', 'pd-status is-error');
	error.setAttribute('role', 'alert');
	dlg.body.append(error);

	const save = async () => {
		const name = (entry ? entry.name : nameInput.value).trim();
		const baseUrl = urlInput.value.trim() || entry?.baseUrl || '';
		const apiKey = keyInput.value.trim();
		error.textContent = '';
		if (!name) { error.textContent = t('pdNeedName'); return; }
		if (!baseUrl) { error.textContent = t('pdNeedUrl'); return; }
		if (signIn === 'chatgpt' || signIn === 'codex') {
			if (!oauth || oauth.kind !== signIn) { error.textContent = t('pdNeedLogin'); return; }
		} else if ((entry ? entry.apiKeyRequired !== false : true) && !apiKey) {
			error.textContent = t('pdNeedKey'); return;
		}
		const provider: Provider = {
			id: existing?.id || newId(), name, baseUrl,
			apiKey: signIn === 'chatgpt' || signIn === 'codex' ? '' : apiKey,
			apiKeyRequired: entry ? entry.apiKeyRequired !== false : true,
			...(entry ? { presetId: entry.id } : {}),
			...(signIn === 'chatgpt' || signIn === 'codex' ? { oauth } : {})
		};
		const index = existing ? generalSettings.providers.indexOf(existing) : -1;
		if (index >= 0) generalSettings.providers[index] = provider; else generalSettings.providers.push(provider);
		try { await saveSettings(); } catch { error.textContent = t('failedToSaveProvider'); return; }
		pending?.handle.cancel();
		dlg.close();
		done();
	};

	if (!existing) dlg.actions.append(button(t('pdBack'), 'pd-ghost', () => { pending?.handle.cancel(); back(); }));
	dlg.actions.append(button(t('cancel'), '', () => { pending?.handle.cancel(); dlg.close(); }), button(existing ? t('save') : t('pdAddProviderButton'), 'pd-primary', () => { void save(); }));
	(entry ? keyInput : nameInput).focus();
}

export function openProviderEditor(provider: Provider, presets: Record<string, any>, done: Done): void {
	const dlg = openDialog('provider-modal', t('pdEditProviderTitle'));
	const entry = CATALOG.find(e => e.id === provider.presetId || e.name === provider.name) || null;
	showProviderForm(dlg, entry, provider, presets, done, () => {});
}

// ---- models ----------------------------------------------------------------------------------

export function openModelPicker(done: Done, openProviders: () => void, editing?: ModelConfig): void {
	const providers = generalSettings.providers.filter(Boolean);
	const dlg = openDialog('model-modal', editing ? t('editModel') : t('pdAddModelTitle'));
	dlg.modal.classList.add('pd-wide');
	if (!providers.length) {
		dlg.modal.classList.remove('pd-wide');
		dlg.body.append(el('div', 'pd-empty', t('pdNoProviders')));
		dlg.actions.append(button(t('cancel'), '', dlg.close), button(t('pdAddProviderTitle'), 'pd-primary', () => { dlg.close(); openProviders(); }));
		return;
	}
	if (editing) { showModelEditor(dlg, editing, done); return; }

	let provider: Provider | undefined = providers.length === 1 ? providers[0] : undefined;
	const picked = new Map<string, ProviderModel>();
	let available: ProviderModel[] = [];
	let version = 0;
	let controller: AbortController | undefined;

	const chips = el('div', 'pd-chips');
	chips.setAttribute('role', 'radiogroup');
	chips.setAttribute('aria-label', t('pdPickProvider'));
	const search = input('search', '', t('pdSearchModels'));
	search.className = 'pd-search';
	search.setAttribute('aria-label', t('pdSearchModels'));
	const status = el('div', 'pd-status');
	status.setAttribute('role', 'status');
	const list = el('div', 'pd-models');
	const manual = el('details', 'pd-more');
	manual.append(el('summary', '', t('pdManual')));
	const manualId = input('text', '', 'gpt-5.6-luna');
	const manualName = input('text', '', t('pdManualNamePlaceholder'));
	manual.append(field('pd-mid', t('providerModelId'), manualId), field('pd-mname', t('pdManualName'), manualName));
	dlg.body.append(chips, search, status, list, manual);

	const addBtn = button('', 'pd-primary', () => { void commit(); });
	const refresh = () => {
		const n = picked.size + (manualId.value.trim() ? 1 : 0);
		addBtn.textContent = n ? t('pdAddModels', String(n)) : t('pdAddModelsNone');
		addBtn.disabled = n === 0 || !provider;
	};
	const exists = (id: string) => !!provider && generalSettings.models.some(m => m.providerId === provider!.id && m.providerModelId === id);

	const renderList = () => {
		const q = search.value.trim().toLowerCase();
		const rec = new Set((brandOf(provider || {})?.popularModels || []).filter(m => m.recommended).map(m => m.id));
		list.textContent = '';
		for (const m of available.filter(m => !q || `${m.name} ${m.id}`.toLowerCase().includes(q))) {
			const isIn = exists(m.id);
			const row = press(el('div', `pd-model${picked.has(m.id) ? ' is-picked' : ''}${isIn ? ' is-added' : ''}`), m.name, () => {
				if (isIn) return;
				if (picked.has(m.id)) picked.delete(m.id); else picked.set(m.id, m);
				renderList(); refresh();
			});
			row.setAttribute('role', 'checkbox');
			row.setAttribute('aria-checked', String(isIn || picked.has(m.id)));
			if (isIn) row.setAttribute('aria-disabled', 'true');
			const text = el('div', 'pd-model-text');
			text.append(el('div', 'pd-model-name', m.name));
			if (m.name !== m.id) text.append(el('div', 'pd-model-id', m.id));
			row.append(el('span', 'pd-check', isIn || picked.has(m.id) ? '✓' : ''), text);
			if (rec.has(m.id)) row.append(el('span', 'pd-tag', t('pdRecommended')));
			if (isIn) row.append(el('span', 'pd-tag', t('pdAdded')));
			list.append(row);
		}
	};

	const load = async () => {
		controller?.abort();
		const my = ++version;
		available = []; picked.clear(); list.textContent = ''; refresh();
		if (!provider) { status.textContent = t('pdPickProviderFirst'); return; }
		controller = new AbortController();
		status.classList.remove('is-error');
		status.textContent = t('providerModelsLoading');
		try {
			available = await fetchProviderModels(provider, controller.signal);
			if (my !== version) return;
			status.textContent = available.length ? '' : t('providerModelsEmpty');
			renderList();
		} catch (error) {
			if (my !== version) return;
			status.classList.add('is-error');
			const reason = error instanceof Error ? error.message : '';
			const base = t(reason === 'missing-api-key' ? 'providerModelsMissingKey' : reason === 'deployment-models' ? 'providerModelsDeployment' : 'providerModelsFailed');
			const detail = /abort/i.test(reason) ? t('pdReasonTimeout') : /^http-(\d+)$/.test(reason) ? `HTTP ${reason.slice(5)}` : reason === 'invalid-model-list' ? t('pdReasonFormat') : reason.startsWith('network:') ? t('pdReasonNetwork') : '';
			status.textContent = detail ? `${base}（${detail}）` : base;
			const retry = press(el('span', 'pd-retry', t('providerModelsRefresh')), t('providerModelsRefresh'), () => { void load(); });
			status.append(' ', retry);
			manual.open = true;
		}
	};

	const renderChips = () => {
		chips.textContent = '';
		providers.forEach(p => {
			const c = press(el('div', `pd-chip${provider?.id === p.id ? ' is-on' : ''}`), p.name, () => { provider = p; renderChips(); void load(); });
			c.setAttribute('role', 'radio');
			c.setAttribute('aria-checked', String(provider?.id === p.id));
			c.append(iconTile(p, 'sm'), el('span', '', p.name));
			chips.append(c);
		});
		if (providers.length === 1) chips.hidden = true;
	};

	const commit = async () => {
		if (!provider) return;
		const items = [...picked.values()];
		const id = manualId.value.trim();
		if (id && !items.some(m => m.id === id)) items.push({ id, name: manualName.value.trim() || id });
		for (const m of items) {
			if (exists(m.id)) continue;
			generalSettings.models.push({ id: newId() + generalSettings.models.length, providerId: provider.id, providerModelId: m.id, name: m.name, enabled: true });
		}
		try { await saveSettings(); } catch { status.classList.add('is-error'); status.textContent = t('failedToSaveModel'); return; }
		controller?.abort();
		dlg.close();
		done();
	};

	search.addEventListener('input', renderList);
	manualId.addEventListener('input', refresh);
	dlg.actions.append(button(t('cancel'), '', () => { controller?.abort(); dlg.close(); }), addBtn);
	renderChips();
	refresh();
	void load();
}

function showModelEditor(dlg: Dialog, model: ModelConfig, done: Done): void {
	dlg.modal.classList.remove('pd-wide');
	const provider = generalSettings.providers.find(p => p && p.id === model.providerId);
	const head = el('div', 'pd-head');
	head.append(iconTile(provider || {}, 'md'), el('strong', '', provider?.name || t('unknownProvider')));
	const nameInput = input('text', model.name, t('modelName'));
	const idInput = input('text', model.providerModelId || '', t('providerModelId'));
	const error = el('div', 'pd-status is-error');
	error.setAttribute('role', 'alert');
	dlg.body.append(head, field('pd-mname', t('modelName'), nameInput), field('pd-mid', t('providerModelId'), idInput, el('div', 'pd-hint', t('providerModelIdDescription'))), error);
	dlg.actions.append(button(t('cancel'), '', dlg.close), button(t('save'), 'pd-primary', async () => {
		const name = nameInput.value.trim();
		const providerModelId = idInput.value.trim();
		if (!name || !providerModelId) { error.textContent = t('modelRequiredFields'); return; }
		const index = generalSettings.models.findIndex(m => m.id === model.id);
		const next = { ...model, name, providerModelId };
		if (index >= 0) generalSettings.models[index] = next; else generalSettings.models.push(next);
		try { await saveSettings(); } catch { error.textContent = t('failedToSaveModel'); return; }
		dlg.close();
		done();
	}));
	nameInput.focus();
}
