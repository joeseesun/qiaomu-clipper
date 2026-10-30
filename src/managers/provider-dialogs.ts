import { reasoningEffortOption } from '../utils/reasoning-label';
import { detectMagpie, magpieKey } from '../utils/magpie';
// The two dialogs behind "添加服务商" and "添加模型": a card gallery with brand icons for picking a
// provider, a short form for it, and a searchable list for picking models. Cards and rows are divs:
// the app's global button style stretches buttons to the full width of their container.
import { ModelConfig, OAuthCredentials, Provider } from '../types/types';
import { generalSettings, saveSettings } from '../utils/storage-utils';
import { getMessage } from '../utils/i18n';
import { t } from '../utils/ui-text';
import { showModal, hideModal } from '../utils/modal-utils';
import { startSignIn, PendingSignIn } from '../utils/oauth/accounts';
import { fallbackModels, fetchProviderModels, ProviderModel } from '../utils/provider-models';
import { CATALOG, CatalogEntry, GROUP_ORDER, ProviderGroup, brandOf, iconTile } from '../utils/provider-catalog';

type Done = () => void;

const msg = getMessage;
const GROUP_LABEL: Record<ProviderGroup, string> = { plan: 'pdGroupPlan', account: 'pdGroupAccount', relay: 'pdGroupRelay', provider: 'pdGroupProvider', local: 'pdGroupLocal' };

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

interface Dialog { modal: HTMLElement; body: HTMLElement; actions: HTMLElement; close(): void; reset(): void; onLeave(cleanup: () => void): void; isOpen(): boolean }
const dialogs = new WeakMap<HTMLElement, Dialog>();

function openDialog(id: string, title: string): Dialog {
	const modal = document.getElementById(id) as HTMLElement;
	dialogs.get(modal)?.close();
	const body = modal.querySelector('.pd-body') as HTMLElement;
	const actions = modal.querySelector('.pd-actions') as HTMLElement;
	(modal.querySelector('.pd-title') as HTMLElement).textContent = title;
	body.textContent = '';
	actions.textContent = '';
	showModal(modal);
	const cleanup = new Set<() => void>();
	const leave = () => { cleanup.forEach(fn => fn()); cleanup.clear(); };
	const observer = new MutationObserver(() => { if (modal.style.display === 'none') { leave(); observer.disconnect(); } });
	observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
	const dlg: Dialog = { modal, body, actions, close: () => { leave(); observer.disconnect(); hideModal(modal); },
		reset: () => { leave(); body.replaceChildren(); actions.replaceChildren(); }, onLeave: fn => { cleanup.add(fn); }, isOpen: () => modal.style.display !== 'none' };
	dialogs.set(modal, dlg);
	return dlg;
}

function setupStep(dlg: Dialog, current: 1 | 2): void {
	const steps = el('div', 'pd-steps');
	[t('配置服务商'), t('选择模型')].forEach((label, index) => {
		const step = el('span', index + 1 === current ? 'is-current' : '', `${index + 1}  ${label}`);
		if (index + 1 === current) step.setAttribute('aria-current', 'step');
		steps.append(step);
	});
	dlg.body.append(steps);
}
interface SelectionDraft { picked: Map<string, ProviderModel>; query: string; manualId: string; manualName: string; connection?: Provider }
const selectionDraft = (): SelectionDraft => ({ picked: new Map(), query: '', manualId: '', manualName: '' });
interface SetupFlow { dlg: Dialog; provider: Provider; draft: SelectionDraft; back(): void }

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
	const dlg = openDialog('provider-modal', msg('pdAddProviderTitle'));
	dlg.modal.classList.add('pd-wide');
	const entries = galleryEntries(presets);
	const added = (e: CatalogEntry) => generalSettings.providers.find(p => p && (p.presetId === e.id || p.name === e.name));

	const search = input('search', '', msg('pdSearchProviders'));
	search.className = 'pd-search';
	search.setAttribute('aria-label', msg('pdSearchProviders'));
	const grid = el('div', 'pd-gallery');
	dlg.body.append(search, grid);

	const open = (entry: CatalogEntry | null) => showProviderForm(dlg, entry, entry ? added(entry) : undefined, presets, done, () => openProviderPicker(presets, done), selectionDraft());

	const card = (entry: CatalogEntry, existing?: Provider) => {
		const c = press(el('div', `pd-card${existing ? ' is-added' : ''}`), entry.name, () => open(entry));
		const text = el('div', 'pd-card-text');
		text.append(el('div', 'pd-card-name', entry.name), el('div', 'pd-card-sub', entry.sub));
		c.append(iconTile({ presetId: entry.id, baseUrl: entry.baseUrl, name: entry.name }, 'lg'), text);
		if (existing) { const ok = el('span', 'pd-card-mark', '✓'); ok.setAttribute('aria-label', msg('pdAdded')); c.append(ok); }
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
			grid.append(el('div', 'pd-group', msg(GROUP_LABEL[group])));
			const row = el('div', 'pd-cards');
			list.forEach(e => row.append(card(e, added(e))));
			grid.append(row);
		}
		if (!q || msg('pdCustomName').toLowerCase().includes(q)) {
			grid.append(el('div', 'pd-group', msg('pdGroupCustom')));
			const row = el('div', 'pd-cards');
			const c = press(el('div', 'pd-card is-custom'), msg('pdCustomName'), () => open(null));
			const text = el('div', 'pd-card-text');
			text.append(el('div', 'pd-card-name', msg('pdCustomName')), el('div', 'pd-card-sub', msg('pdCustomSub')));
			c.append(el('span', 'provider-tile is-lg is-plus', '+'), text);
			row.append(c);
			grid.append(row);
			count++;
		}
		if (!count) grid.append(el('div', 'pd-empty', msg('pdNoMatch')));
	};
	search.addEventListener('input', render);
	render();
	dlg.actions.append(button(msg('cancel'), '', dlg.close));
	search.focus();
}

function showProviderForm(dlg: Dialog, entry: CatalogEntry | null, existing: Provider | undefined, presets: Record<string, any>, done: Done, back: () => void, draft?: SelectionDraft): void {
	dlg.modal.classList.remove('pd-wide');
	dlg.reset();
	if (draft) setupStep(dlg, 1);
	const title = dlg.modal.querySelector('.pd-title') as HTMLElement;
	title.textContent = existing ? msg('pdEditProviderTitle') : msg('pdAddProviderTitle');

	let oauth: OAuthCredentials | undefined = existing?.oauth;
	let pending: PendingSignIn | undefined;
	let active = true;
	dlg.onLeave(() => { active = false; pending?.handle.cancel(); pending = undefined; });
	const current = () => active && dlg.isOpen();
	const head = el('div', 'pd-head');
	const preview = { presetId: entry?.id, baseUrl: existing?.baseUrl || entry?.baseUrl || '', name: existing?.name || entry?.name || '' };
	head.append(iconTile(preview, 'lg'));
	const nameInput = input('text', existing?.name || '', msg('pdFieldNamePlaceholder'));
	if (entry) head.append(el('strong', '', entry.name)); else head.append(nameInput);
	dlg.body.append(head);

	const note = el('div', 'pd-note');
	const signIn = entry?.signIn;
	// These sign-ins hand back an ordinary API key that fills the key field.
	const keySignIn = signIn === 'tokendance' || signIn === 'openrouter';
	const status = el('div', 'pd-status');
	status.setAttribute('role', 'status');
	const keyInput = input('password', existing?.apiKey || '', 'sk-…');
	const urlInput = input('text', existing?.baseUrl || entry?.baseUrl || '', 'https://');
	let signInBtn: HTMLButtonElement | undefined;

	const setSignedIn = (label: string) => { status.textContent = msg('providerSignInDone', label); status.classList.remove('is-error'); if (signInBtn) signInBtn.textContent = msg('providerSignInAgain'); };
	const run = async () => {
		if (!signIn || !signInBtn) return;
		pending?.handle.cancel();
		signInBtn.disabled = true;
		status.classList.remove('is-error');
		status.textContent = msg('providerSignInOpen');
		paste.hidden = false;
		try {
			const started = await startSignIn(signIn, oauth);
			if (!current()) { started.handle.cancel(); return; }
			pending = started;
			const result = await pending.finish();
			if (!current()) return;
			if (result.apiKey) { keyInput.value = result.apiKey; oauth = undefined; }
			if (result.oauth) { oauth = result.oauth; keyInput.value = ''; }
			setSignedIn(result.label);
			if (draft) await save();
		} catch (error) {
			if (!current()) return;
			status.textContent = error instanceof Error ? error.message : String(error);
			status.classList.add('is-error');
			signInBtn.textContent = msg('providerSignInAgain');
		} finally {
			if (current()) { signInBtn.disabled = false; paste.hidden = true; pending = undefined; }
		}
	};

	const paste = el('div', 'pd-paste');
	paste.hidden = true;
	const pasteInput = input('text', '', msg('providerSignInPaste'));
	paste.append(pasteInput, button(msg('providerSignInPasteButton'), '', () => {
		if (pending && !pending.handle.submitUrl(pasteInput.value)) { status.textContent = msg('pdPasteWrong'); status.classList.add('is-error'); }
	}));

	if (signIn === 'chatgpt' || signIn === 'codex') {
		note.textContent = msg(signIn === 'codex' ? 'providerSignInNoteCodex' : 'providerSignInNoteChatGPT');
		signInBtn = button(msg(signIn === 'codex' ? 'providerSignInCodex' : 'providerSignInChatGPT'), 'pd-primary', () => { void run(); });
		const row = el('div', 'pd-signin');
		row.append(signInBtn);
		dlg.body.append(note, row, status, paste);
		if (oauth && oauth.kind === signIn) setSignedIn(oauth.email || entry!.name);
	} else {
		if (keySignIn) {
			note.textContent = msg(signIn === 'openrouter' ? 'providerSignInNoteOpenRouter' : 'providerSignInNoteTokenDance');
			signInBtn = button(msg(signIn === 'openrouter' ? 'providerSignInOpenRouter' : 'providerSignInTokenDance'), 'pd-primary', () => { void run(); });
			const row = el('div', 'pd-signin');
			row.append(signInBtn);
			dlg.body.append(note, row, status, paste);
		} else if (entry) {
			note.textContent = entry.id === 'magpie' ? msg('pdMagpieNote') : entry.group === 'local' ? msg('pdLocalNote') : '';
			if (note.textContent) dlg.body.append(note);
		}
		const keyHint = el('div', 'pd-hint');
		if (entry?.apiKeyUrl) {
			const a = el('a', '', msg('pdGetKey'));
			a.href = entry.apiKeyUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
			keyHint.append(a);
		}
		if (!entry) dlg.body.append(field('pd-url', msg('pdFieldUrl'), urlInput, el('div', 'pd-hint', msg('pdUrlHintCustom'))));
		if (!entry || entry.apiKeyRequired !== false || keySignIn || entry.id === 'magpie') {
			const keyRow = field('pd-key', keySignIn ? msg('pdFieldKeyOr') : msg('pdFieldKey'), keyInput, keyHint);
			const reveal = press(el('span', 'pd-reveal', msg('pdShow')), msg('pdShow'), () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; reveal.textContent = keyInput.type === 'password' ? msg('pdShow') : msg('pdHide'); });
			const wrap = el('div', 'pd-input-wrap');
			keyInput.replaceWith(wrap);
			wrap.append(keyInput, reveal);
			keyRow.classList.add('has-reveal');
			dlg.body.append(keyRow);
		}
		if (entry && entry.group !== 'local') {
			const more = el('details', 'pd-more');
			more.append(el('summary', '', msg('pdAdvanced')));
			more.append(field('pd-url', msg('pdFieldUrl'), urlInput, el('div', 'pd-hint', msg('pdUrlHint'))));
			dlg.body.append(more);
		} else if (entry) {
			dlg.body.append(field('pd-url', msg('pdFieldUrl'), urlInput));
		}
	}
	if (entry?.id === 'magpie') {
    const result = el('div', 'pd-status'); result.setAttribute('role', 'status');
    const detect = button(msg('pdDetectMagpie'), 'pd-ghost', () => { detect.disabled = true;
      void detectMagpie({ presetId: 'magpie', baseUrl: urlInput.value.trim() || entry.baseUrl, apiKey: keyInput.value.trim() })
        .then(version => { if (dlg.modal.classList.contains('is-visible') || result.isConnected) result.textContent = `Magpie ${version}`; })
        .catch(() => { if (result.isConnected) result.textContent = msg('pdMagpieFailed'); })
        .finally(() => { detect.disabled = false; });
    }); dlg.body.append(detect, result);
  }
  const error = el('div', 'pd-status is-error');
	error.setAttribute('role', 'alert');
	dlg.body.append(error);

	let saving = false;
	const save = async () => {
		if (saving || !current()) return;
		const name = (entry ? entry.name : nameInput.value).trim();
		const baseUrl = urlInput.value.trim() || entry?.baseUrl || '';
		const apiKey = keyInput.value.trim();
		error.textContent = '';
		if (!name) { error.textContent = msg('pdNeedName'); return; }
		if (!baseUrl) { error.textContent = msg('pdNeedUrl'); return; }
    if (entry?.id === 'magpie') { try { magpieKey({ presetId: 'magpie', baseUrl, apiKey }); } catch { error.textContent = msg('pdMagpieSecure'); return; } }
		if (signIn === 'chatgpt' || signIn === 'codex') {
			if (!oauth || oauth.kind !== signIn) { error.textContent = msg('pdNeedLogin'); return; }
		} else if ((entry ? entry.apiKeyRequired !== false : true) && !apiKey) {
			error.textContent = msg('pdNeedKey'); return;
		}
		const provider: Provider = {
			id: existing?.id || newId(), name, baseUrl,
			apiKey: signIn === 'chatgpt' || signIn === 'codex' ? '' : apiKey,
			apiKeyRequired: entry ? entry.apiKeyRequired !== false : true,
			...(entry ? { presetId: entry.id } : {}),
			...(signIn === 'chatgpt' || signIn === 'codex' ? { oauth } : {})
		};
		saving = true;
		const previous = [...generalSettings.providers];
		const index = existing ? generalSettings.providers.indexOf(existing) : -1;
		if (index >= 0) generalSettings.providers[index] = provider; else generalSettings.providers.push(provider);
		try { await saveSettings(); } catch { generalSettings.providers = previous; saving = false; if (current()) error.textContent = msg('failedToSaveProvider'); return; }
		pending?.handle.cancel();
		done();
		if (!current()) return;
		if (draft) {
			const old = draft.connection;
			if (old && (old.baseUrl !== provider.baseUrl || old.apiKey !== provider.apiKey || old.oauth?.access !== provider.oauth?.access)) { draft.picked.clear(); draft.manualId = ''; draft.manualName = ''; draft.query = ''; }
			draft.connection = provider;
			openModelPicker(done, back, undefined, { dlg, provider, draft, back: () => showProviderForm(dlg, entry, provider, presets, done, back, draft) });
		} else dlg.close();
	};

	if (!existing) dlg.actions.append(button(msg('pdBack'), 'pd-ghost', () => { pending?.handle.cancel(); back(); }));
	dlg.actions.append(button(msg('cancel'), '', dlg.close), button(draft ? t('下一步：选择模型') : msg('save'), 'pd-primary', () => { void save(); }));
	(signInBtn || (entry ? keyInput : nameInput)).focus();
}

export function openProviderEditor(provider: Provider, presets: Record<string, any>, done: Done): void {
	const dlg = openDialog('provider-modal', msg('pdEditProviderTitle'));
	const entry = CATALOG.find(e => e.id === provider.presetId || e.name === provider.name) || null;
	showProviderForm(dlg, entry, provider, presets, done, () => {});
}

// ---- models ----------------------------------------------------------------------------------

export function openModelPicker(done: Done, openProviders: () => void, editing?: ModelConfig, setup?: SetupFlow): void {
	const providers = generalSettings.providers.filter(Boolean);
	const dlg = setup?.dlg || openDialog('model-modal', editing ? msg('editModel') : msg('pdAddModelTitle'));
	if (setup) {
		dlg.reset();
		(dlg.modal.querySelector('.pd-title') as HTMLElement).textContent = `${setup.provider.name} · ${t('选择模型')}`;
		setupStep(dlg, 2);
		dlg.body.append(el('p', 'pd-note', t('服务商已保存。选择要使用的模型，也可以稍后添加。')));
	}
	dlg.modal.classList.add('pd-wide');
	if (!providers.length) {
		dlg.modal.classList.remove('pd-wide');
		dlg.body.append(el('div', 'pd-empty', msg('pdNoProviders')));
		dlg.actions.append(button(msg('cancel'), '', dlg.close), button(msg('pdAddProviderTitle'), 'pd-primary', () => { dlg.close(); openProviders(); }));
		return;
	}
	if (editing) { showModelEditor(dlg, editing, done); return; }

	let provider: Provider | undefined = setup?.provider || (providers.length === 1 ? providers[0] : undefined);
	const picked = setup?.draft.picked || new Map<string, ProviderModel>();
	let available: ProviderModel[] = [];
	let version = 0;
	let controller: AbortController | undefined;
	let active = true;
	dlg.onLeave(() => { active = false; version++; controller?.abort(); });

	const chips = el('div', 'pd-chips');
	chips.setAttribute('role', 'radiogroup');
	chips.setAttribute('aria-label', msg('pdPickProvider'));
	const search = input('search', '', msg('pdSearchModels'));
	search.className = 'pd-search';
	search.setAttribute('aria-label', msg('pdSearchModels'));
	search.value = setup?.draft.query || '';
	const status = el('div', 'pd-status');
	status.setAttribute('role', 'status');
	const list = el('div', 'pd-models');
	const manual = el('details', 'pd-more');
	manual.append(el('summary', '', msg('pdManual')));
	const manualId = input('text', '', 'gpt-5.6-luna');
	const manualName = input('text', '', msg('pdManualNamePlaceholder'));
	manualId.value = setup?.draft.manualId || '';
	manualName.value = setup?.draft.manualName || '';
	manual.append(field('pd-mid', msg('providerModelId'), manualId), field('pd-mname', msg('pdManualName'), manualName));
	dlg.body.append(chips, search, status, list, manual);

	const addBtn = button('', 'pd-primary', () => { void commit(); });
	const refresh = () => {
		const n = picked.size + (manualId.value.trim() ? 1 : 0);
		addBtn.textContent = n ? msg('pdAddModels', String(n)) : msg('pdAddModelsNone');
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
				row.classList.toggle('is-picked', picked.has(m.id));
				row.setAttribute('aria-checked', String(picked.has(m.id)));
				row.querySelector('.pd-check')!.textContent = picked.has(m.id) ? '✓' : '';
				refresh();
			});
			row.setAttribute('role', 'checkbox');
			row.setAttribute('aria-checked', String(isIn || picked.has(m.id)));
			if (isIn) row.setAttribute('aria-disabled', 'true');
			const text = el('div', 'pd-model-text');
			text.append(el('div', 'pd-model-name', m.name));
			if (m.name !== m.id) text.append(el('div', 'pd-model-id', m.id));
			row.append(el('span', 'pd-check', isIn || picked.has(m.id) ? '✓' : ''), text);
			if (rec.has(m.id)) row.append(el('span', 'pd-tag', msg('pdRecommended')));
			if (isIn) row.append(el('span', 'pd-tag', msg('pdAdded')));
			list.append(row);
		}
	};

	const load = async () => {
		controller?.abort();
		const my = ++version;
		available = []; list.textContent = ''; refresh();
		if (!provider) { status.textContent = msg('pdPickProviderFirst'); return; }
		controller = new AbortController();
		status.classList.remove('is-error');
		status.textContent = msg('providerModelsLoading');
		try {
			const found = await fetchProviderModels(provider, controller.signal);
			if (my !== version || !active || !dlg.isOpen()) return;
			available = found;
			status.textContent = available.length ? '' : msg('providerModelsEmpty');
			if (!available.length) manual.open = true;
			renderList();
		} catch (error) {
			if (my !== version || !active || !dlg.isOpen()) return;
			status.classList.add('is-error');
			const reason = error instanceof Error ? error.message : '';
			const base = msg(reason === 'missing-api-key' ? 'providerModelsMissingKey' : reason === 'deployment-models' ? 'providerModelsDeployment' : 'providerModelsFailed');
			const detail = /abort/i.test(reason) ? msg('pdReasonTimeout') : /^http-(\d+)$/.test(reason) ? `HTTP ${reason.slice(5)}` : reason === 'invalid-model-list' ? msg('pdReasonFormat') : reason.startsWith('network:') ? msg('pdReasonNetwork') : '';
			status.textContent = detail ? `${base}（${detail}）` : base;
			const retry = press(el('span', 'pd-retry', msg('providerModelsRefresh')), msg('providerModelsRefresh'), () => { void load(); });
			status.append(' ', retry);
			manual.open = true;
			// The vendor's list is the truth; only when it cannot be read do the catalogue's common models stand in.
			const common = fallbackModels(provider);
			if (common.length) { available = common; status.textContent = msg('providerModelsFallback') + ' '; status.append(retry); status.classList.remove('is-error'); renderList(); }
		}
	};

	const renderChips = () => {
		chips.textContent = '';
		providers.forEach(p => {
			const c = press(el('div', `pd-chip${provider?.id === p.id ? ' is-on' : ''}`), p.name, () => { if (provider?.id === p.id) return; provider = p; picked.clear(); manualId.value = ''; manualName.value = ''; renderChips(); void load(); });
			c.setAttribute('role', 'radio');
			c.setAttribute('aria-checked', String(provider?.id === p.id));
			c.append(iconTile(p, 'sm'), el('span', '', p.name));
			chips.append(c);
		});
		if (providers.length === 1 || setup) chips.hidden = true;
	};

	let savingModels = false;
	const commit = async () => {
		if (!provider || addBtn.disabled || savingModels) return;
		savingModels = true;
		addBtn.disabled = true;
		const previous = [...generalSettings.models];
		const items = [...picked.values()];
		const id = manualId.value.trim();
		if (id && !items.some(m => m.id === id)) items.push({ id, name: manualName.value.trim() || id });
		for (const m of items) {
			if (exists(m.id)) continue;
			generalSettings.models.push({ id: newId() + generalSettings.models.length, providerId: provider.id, providerModelId: m.id, name: m.name, enabled: true, reasoningEfforts: m.reasoningEfforts });
		}
		try { await saveSettings(); } catch {
			generalSettings.models = previous; savingModels = false;
			if (active && dlg.isOpen()) { refresh(); status.classList.add('is-error'); status.textContent = msg('failedToSaveModel'); }
			return;
		}
		controller?.abort();
		if (active && dlg.isOpen()) dlg.close();
		done();
	};

	search.addEventListener('input', renderList);
	manualId.addEventListener('input', refresh);
	if (setup) dlg.actions.append(button(t('返回连接'), 'pd-ghost', () => {
		setup.draft.query = search.value; setup.draft.manualId = manualId.value; setup.draft.manualName = manualName.value; setup.back();
	}));
	dlg.actions.append(button(setup ? t('稍后添加') : msg('cancel'), '', dlg.close), addBtn);
	renderChips();
	refresh();
	void load();
	search.focus();
}

function showModelEditor(dlg: Dialog, model: ModelConfig, done: Done): void {
	dlg.modal.classList.remove('pd-wide');
	const provider = generalSettings.providers.find(p => p && p.id === model.providerId);
	const head = el('div', 'pd-head');
	head.append(iconTile(provider || {}, 'md'), el('strong', '', provider?.name || msg('unknownProvider')));
	const nameInput = input('text', model.name, msg('modelName'));
	const idInput = input('text', model.providerModelId || '', msg('providerModelId'));
  const effort = el('select'); effort.append(new Option(msg('pdEffortDefault'), ''));
  for (const value of model.reasoningEfforts || []) effort.append(reasoningEffortOption(value));
  effort.value = model.reasoningEffort || '';
  if (model.reasoningEfforts?.length) { const row = el('label', 'pd-field', msg('pdEffort')); row.append(effort); dlg.body.append(row); }
	const error = el('div', 'pd-status is-error');
	error.setAttribute('role', 'alert');
	dlg.body.append(head, field('pd-mname', msg('modelName'), nameInput), field('pd-mid', msg('providerModelId'), idInput, el('div', 'pd-hint', msg('providerModelIdDescription'))), error);
	dlg.actions.append(button(msg('cancel'), '', dlg.close), button(msg('save'), 'pd-primary', async () => {
		const name = nameInput.value.trim();
		const providerModelId = idInput.value.trim();
		if (!name || !providerModelId) { error.textContent = msg('modelRequiredFields'); return; }
		const index = generalSettings.models.findIndex(m => m.id === model.id);
		const previous = [...generalSettings.models];
		const next = { ...model, name, providerModelId, reasoningEffort: providerModelId === model.providerModelId ? effort.value || undefined : undefined, reasoningEfforts: providerModelId === model.providerModelId ? model.reasoningEfforts : undefined };
		if (index >= 0) generalSettings.models[index] = next; else generalSettings.models.push(next);
		try { await saveSettings(); } catch { generalSettings.models = previous; error.textContent = msg('failedToSaveModel'); return; }
		dlg.close();
		done();
	}));
	nameInput.focus();
}
