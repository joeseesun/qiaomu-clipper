// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeInterpreterSettings } from './interpreter-settings';
import { generalSettings, saveSettings } from '../utils/storage-utils';
import { fetchProviderModels, ProviderModel } from '../utils/provider-models';

vi.mock('../utils/storage-utils', () => ({
	generalSettings: { providers: [], models: [], defaultPromptContext: '' },
	loadSettings: vi.fn(), saveSettings: vi.fn(),
	getLocalStorage: vi.fn(async () => ({ version: 'test' })), setLocalStorage: vi.fn()
}));
vi.mock('../utils/ui-utils', () => ({ initializeToggles: vi.fn(), initializeSettingToggle: vi.fn() }));
vi.mock('../icons/icons', () => ({ initializeIcons: vi.fn() }));
vi.mock('../utils/i18n', () => ({ getMessage: (key: string, sub?: string) => sub ? `${key}:${sub}` : key, translatePage: vi.fn() }));
vi.mock('../utils/provider-models', () => ({ fetchProviderModels: vi.fn(), fallbackModels: vi.fn(() => []) }));
vi.mock('../utils/oauth/accounts', () => ({ startSignIn: vi.fn(), CHATGPT_BASE: 'https://api.openai.com/v1', CODEX_BASE: 'https://chatgpt.com/backend-api/codex' }));

const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
const action = (label: string) => $$<HTMLButtonElement>('#model-modal .pd-actions button, #provider-modal .pd-actions button').find(b => b.textContent === label)!;
const openModels = async () => { $('#add-model-btn').click(); await tick(); };
const openProviders = async () => { $('#add-provider-btn').click(); await tick(); };
const card = (name: string) => $$('#provider-modal .pd-card').find(c => c.getAttribute('aria-label') === name)!;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.mocked(saveSettings).mockReset();
	vi.mocked(fetchProviderModels).mockReset();
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 'test' }))));
	document.documentElement.innerHTML = readFileSync('src/settings.html', 'utf8');
	generalSettings.providers = [
		{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', apiKey: 'a-key', apiKeyRequired: true },
		{ id: 'b', name: 'Custom', baseUrl: 'https://gateway.example/v1/chat/completions', apiKey: 'b-key' }
	];
	generalSettings.models = [];
	await initializeInterpreterSettings();
});

describe('provider list', () => {
	it('shows a brand icon and where each provider lives', () => {
		const rows = $$('#provider-list .provider-list-item');
		expect(rows).toHaveLength(2);
		expect(rows[1].querySelector('.provider-tile svg')).not.toBeNull(); // DeepSeek has its own mark
		expect(rows[0].querySelector('.provider-tile.is-letter')).not.toBeNull(); // a custom gateway gets a letter
		expect(rows[1].textContent).toContain('api.deepseek.com');
	});
});

describe('add provider', () => {
	it('lists account sign-ins and providers as cards, marks the ones already added, and filters by search', async () => {
		await openProviders();
		const names = $$('#provider-modal .pd-card').map(c => c.getAttribute('aria-label'));
		expect(names).toEqual(expect.arrayContaining(['ChatGPT', 'Codex', '词元跳动', '硅基流动', 'DeepSeek', 'Ollama', 'pdCustomName']));
		expect(card('DeepSeek').classList.contains('is-added')).toBe(true);
		const search = $<HTMLInputElement>('#provider-modal .pd-search');
		search.value = '硅基'; search.dispatchEvent(new Event('input'));
		expect($$('#provider-modal .pd-card').map(c => c.getAttribute('aria-label'))).toEqual(['硅基流动']);
	});
	it('adds a keyed provider with only a key to type', async () => {
		await openProviders();
		card('硅基流动').click();
		expect($('#provider-modal #pd-url')).not.toBeNull();
		action('pdAddProviderButton').click(); await tick();
		expect($('#provider-modal .pd-status.is-error').textContent).toBe('pdNeedKey');
		($('#pd-key') as HTMLInputElement).value = ' sk-1 ';
		action('pdAddProviderButton').click(); await tick();
		expect(generalSettings.providers[generalSettings.providers.length - 1]).toMatchObject({ name: '硅基流动', apiKey: 'sk-1', presetId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions' });
		expect(saveSettings).toHaveBeenCalled();
		expect($('#provider-modal').style.display).toBe('none');
		expect($$('#provider-list .provider-list-item')).toHaveLength(3);
	});
	it('needs a sign-in, not a key, for ChatGPT', async () => {
		await openProviders();
		card('ChatGPT').click();
		expect($('#pd-key')).toBeNull();
		action('pdAddProviderButton').click(); await tick();
		expect($('#provider-modal .pd-status.is-error').textContent).toBe('pdNeedLogin');
		expect(generalSettings.providers).toHaveLength(2);
	});
	it('adds a custom provider with a name and an address', async () => {
		await openProviders();
		card('pdCustomName').click();
		($('#provider-modal .pd-head input') as HTMLInputElement).value = 'My gateway';
		($('#pd-url') as HTMLInputElement).value = 'https://g.example/v1/chat/completions';
		($('#pd-key') as HTMLInputElement).value = 'k';
		action('pdAddProviderButton').click(); await tick();
		expect(generalSettings.providers[generalSettings.providers.length - 1]).toMatchObject({ name: 'My gateway', baseUrl: 'https://g.example/v1/chat/completions', apiKey: 'k' });
	});
	it('rolls back a provider after a failed save instead of duplicating it on retry', async () => {
		vi.mocked(saveSettings).mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
		await openProviders(); card('硅基流动').click();
		$<HTMLInputElement>('#pd-key').value='test'; action('pdAddProviderButton').click(); await tick();
		expect(generalSettings.providers).toHaveLength(2);
		action('pdAddProviderButton').click(); await tick(); expect(generalSettings.providers).toHaveLength(3);
	});
	it('ignores repeated provider save clicks until persistence completes', async () => {
		let resolveSave!: () => void;
		vi.mocked(saveSettings).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
		await openProviders(); card('硅基流动').click();
		$<HTMLInputElement>('#pd-key').value = 'test';
		const save = action('pdAddProviderButton'); save.click(); save.click();
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(generalSettings.providers).toHaveLength(3);
		resolveSave(); await tick();
	});
	it('opens an added card for editing instead of adding it twice', async () => {
		await openProviders();
		card('DeepSeek').click();
		expect(($('#pd-key') as HTMLInputElement).value).toBe('a-key');
		($('#pd-key') as HTMLInputElement).value = 'new';
		action('save').click(); await tick();
		expect(generalSettings.providers).toHaveLength(2);
		expect(generalSettings.providers[0].apiKey).toBe('new');
	});
});

describe('add models', () => {
	it('picks several models at once from the provider list and skips ones already added', async () => {
		generalSettings.models = [{ id: 'm0', providerId: 'a', providerModelId: 'old', name: 'Old', enabled: true }];
		vi.mocked(fetchProviderModels).mockResolvedValue([{ id: 'old', name: 'Old' }, { id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]);
		await openModels();
		$$('#model-modal .pd-chip')[0].click(); await tick();
		expect(fetchProviderModels).toHaveBeenCalledWith(generalSettings.providers[0], expect.any(AbortSignal));
		const rows = $$('#model-modal .pd-model');
		expect(rows[0].getAttribute('aria-disabled')).toBe('true');
		rows[0].click(); rows[1].click(); $$('#model-modal .pd-model')[2].click();
		expect(action('pdAddModels:2')).toBeTruthy();
		action('pdAddModels:2').click(); await tick();
		expect(generalSettings.models.map(m => [m.providerId, m.providerModelId])).toEqual([['a', 'old'], ['a', 'x'], ['a', 'y']]);
		expect($$('#model-list .model-list-item')).toHaveLength(3);
	});
	it('ignores an old response after switching providers', async () => {
		let resolveOld!: (items: ProviderModel[]) => void;
		vi.mocked(fetchProviderModels).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([{ id: 'b-model', name: 'B' }]);
		await openModels();
		const chips = $$('#model-modal .pd-chip');
		chips[0].click(); chips[1].click(); await tick();
		resolveOld([{ id: 'stale', name: 'Stale' }]); await tick();
		expect($('#model-modal .pd-models').textContent).toContain('b-model');
		expect($('#model-modal .pd-models').textContent).not.toContain('stale');
	});
	it('says why the list failed, offers a retry and still lets you type an ID', async () => {
		vi.mocked(fetchProviderModels).mockRejectedValueOnce(new Error('http-401')).mockResolvedValue([{ id: 'fresh', name: 'Fresh' }]);
		await openModels();
		$$('#model-modal .pd-chip')[0].click(); await tick();
		expect($('#model-modal .pd-status').textContent).toContain('providerModelsFailed（HTTP 401）');
		expect($('#model-modal details.pd-more').hasAttribute('open')).toBe(true);
		($('#pd-mid') as HTMLInputElement).value = 'manual'; ($('#pd-mid') as HTMLInputElement).dispatchEvent(new Event('input'));
		$('#model-modal .pd-retry').click(); await tick();
		expect($('#model-modal .pd-models').textContent).toContain('fresh');
		expect(($('#pd-mid') as HTMLInputElement).value).toBe('manual');
		action('pdAddModels:1').click(); await tick();
		expect(generalSettings.models[0]).toMatchObject({ providerModelId: 'manual', name: 'manual' });
	});
	it('sends you to add a provider when there is none', async () => {
		generalSettings.providers = [];
		await openModels();
		expect($('#model-modal .pd-body').textContent).toBe('pdNoProviders');
		action('pdAddProviderTitle').click(); await tick();
		expect($('#provider-modal').style.display).toBe('flex');
	});
	it('does not keep unsaved models after a failed save and can retry', async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue([{ id: 'new', name: 'New' }]);
		vi.mocked(saveSettings).mockRejectedValueOnce(new Error('QUOTA_BYTES_PER_ITEM')).mockResolvedValue(undefined);
		await openModels(); $$('#model-modal .pd-chip')[0].click(); await tick();
		$('#model-modal .pd-model').click(); action('pdAddModels:1').click(); await tick();
		expect(generalSettings.models).toEqual([]);
		expect($('#model-modal .pd-status').textContent).toBe('failedToSaveModel');
		action('pdAddModels:1').click(); await tick();
		expect(generalSettings.models).toHaveLength(1);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});
	it('keeps selected models when the active provider is pressed again', async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue([{ id: 'new', name: 'New' }]);
		await openModels(); $$('#model-modal .pd-chip')[0].click(); await tick();
		$('#model-modal .pd-model').click(); $$('#model-modal .pd-chip')[0].click(); await tick();
		expect(action('pdAddModels:1')).toBeTruthy();
		expect(fetchProviderModels).toHaveBeenCalledTimes(1);
	});
	it('opens manual entry for an empty catalog and clears it when changing provider', async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue([]);
		await openModels(); $$('#model-modal .pd-chip')[0].click(); await tick();
		expect($('#model-modal details').hasAttribute('open')).toBe(true);
		const id = $<HTMLInputElement>('#model-modal #pd-mid'); id.value = 'only-for-a'; id.dispatchEvent(new Event('input'));
		$$('#model-modal .pd-chip')[1].click(); await tick();
		expect(id.value).toBe('');
		expect(action('pdAddModelsNone').disabled).toBe(true);
	});
	it('does not submit twice while saving selected models', async () => {
		let resolveSave!: () => void;
		vi.mocked(saveSettings).mockImplementationOnce(() => new Promise(resolve => {resolveSave=resolve;}));
		vi.mocked(fetchProviderModels).mockResolvedValue([{id:'x',name:'X'}]);
		await openModels(); $$('#model-modal .pd-chip')[0].click(); await tick();
		$('#model-modal .pd-model').click(); const btn=action('pdAddModels:1'); btn.click(); btn.click();
		expect(saveSettings).toHaveBeenCalledTimes(1); expect(btn.disabled).toBe(true);
		resolveSave(); await tick(); expect(generalSettings.models).toHaveLength(1);
	});
	it('does not wait for remote presets to wire model buttons', async () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
		document.documentElement.innerHTML = readFileSync('src/settings.html', 'utf8');
		const pending = initializeInterpreterSettings();
		await tick();
		await openModels();
		expect($('#model-modal').style.display).toBe('flex');
		await pending;
	});
	it('keeps provider/model settings available while interpretation is off', async () => {
		expect($('#interpreter-section').classList.contains('is-disabled')).toBe(false);
	});
	it('edits the name and ID of an existing model', async () => {
		generalSettings.models = [{ id: 'saved', providerId: 'a', providerModelId: 'legacy', name: 'Mine', enabled: true }];
		await initializeInterpreterSettings();
		$<HTMLButtonElement>('.edit-model-btn').click(); await tick();
		expect(($('#pd-mid') as HTMLInputElement).value).toBe('legacy');
		($('#pd-mname') as HTMLInputElement).value = 'Renamed';
		action('save').click(); await tick();
		expect(generalSettings.models[0]).toMatchObject({ id: 'saved', name: 'Renamed', providerModelId: 'legacy' });
	});
});
