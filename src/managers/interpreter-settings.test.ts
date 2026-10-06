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
vi.mock('../utils/i18n', () => ({ getMessage: (key: string) => key, translatePage: vi.fn() }));
vi.mock('../utils/provider-models', () => ({ fetchProviderModels: vi.fn() }));

const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const field = (name: string) => document.querySelector(`#model-form [name="${name}"]`) as HTMLInputElement;
const selectProvider = async (id: string) => {
	field('providerId').value = id;
	field('providerId').dispatchEvent(new Event('change'));
	await tick();
};
const open = async () => { document.getElementById('add-model-btn')!.click(); await tick(); };
beforeEach(async () => {
	vi.clearAllMocks();
	vi.mocked(fetchProviderModels).mockReset();
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 'test' }))));
	document.documentElement.innerHTML = readFileSync('src/settings.html', 'utf8');
	generalSettings.providers = [
		{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', apiKey: 'a-key' },
		{ id: 'b', name: 'Custom', baseUrl: 'https://gateway.example/v1/chat/completions', apiKey: 'b-key' }
	];
	generalSettings.models = [];
	await initializeInterpreterSettings();
});

describe('model settings modal', () => {
	it('loads the selected provider catalog and saves its real ID', async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue([{ id: 'actual-id', name: 'Actual model' }]);
		await open();
		await selectProvider('a');
		expect(fetchProviderModels).toHaveBeenCalledWith(generalSettings.providers[0], expect.any(AbortSignal));
		const select = document.getElementById('provider-model-select') as HTMLSelectElement;
		expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'actual-id']);
		select.value = 'actual-id'; select.dispatchEvent(new Event('change'));
		expect(field('name').value).toBe('Actual model');
		expect(field('providerModelId').value).toBe('actual-id');
		(document.querySelector('.model-confirm-btn') as HTMLButtonElement).click(); await tick();
		expect(generalSettings.models[0]).toMatchObject({ providerId: 'a', providerModelId: 'actual-id', name: 'Actual model' });
		expect(saveSettings).toHaveBeenCalled();
	});
	it('ignores an old response after switching providers and avoids duplicate listeners on reopen', async () => {
		let resolveOld!: (items: ProviderModel[]) => void;
		vi.mocked(fetchProviderModels).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([{ id: 'b-model', name: 'B' }]);
		await open(); await selectProvider('a'); await selectProvider('b');
		resolveOld([{ id: 'stale', name: 'Stale' }]); await tick();
		expect(document.getElementById('provider-model-select')!.textContent).toContain('b-model');
		expect(document.getElementById('provider-model-select')!.textContent).not.toContain('stale');
		(document.querySelector('.model-cancel-btn') as HTMLButtonElement).click();
		await open(); await selectProvider('b');
		expect(fetchProviderModels).toHaveBeenCalledTimes(3);
	});
	it('keeps existing and manually entered model details when refreshing', async () => {
		generalSettings.models = [{ id: 'saved', providerId: 'a', providerModelId: 'legacy-id', name: 'My name', enabled: true }];
		await initializeInterpreterSettings();
		vi.mocked(fetchProviderModels).mockResolvedValue([{ id: 'new-id', name: 'New' }]);
		(document.querySelector('.edit-model-btn') as HTMLButtonElement).click(); await tick();
		expect(field('providerModelId').value).toBe('legacy-id');
		expect(field('name').value).toBe('My name');
		field('providerModelId').value = 'manual-id'; field('name').value = 'Manual';
		(document.querySelector('#model-selection-radios button') as HTMLButtonElement).click(); await tick();
		expect(field('providerModelId').value).toBe('manual-id');
		expect(field('name').value).toBe('Manual');
	});
	it('allows manual model entry after failure and retries using refresh', async () => {
		vi.mocked(fetchProviderModels).mockRejectedValueOnce(new Error('http-401')).mockResolvedValue([{ id: 'fresh', name: 'Fresh' }]);
		await open(); await selectProvider('a');
		expect(document.querySelector('#model-selection-radios [role="status"]')!.textContent).toBe('providerModelsFailed（HTTP 401）');
		expect(field('providerModelId').disabled).toBe(false);
		field('providerModelId').value = 'manual'; field('name').value = 'Manual';
		(document.querySelector('#model-selection-radios button') as HTMLButtonElement).click(); await tick();
		expect(document.getElementById('provider-model-select')!.textContent).toContain('fresh');
		expect(field('providerModelId').value).toBe('manual');
	});
});
