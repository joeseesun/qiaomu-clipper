import { initializeToggles, initializeSettingToggle } from '../utils/ui-utils';
import { ModelConfig, Provider } from '../types/types';
import { generalSettings, loadSettings, saveSettings, getLocalStorage, setLocalStorage } from '../utils/storage-utils';
import { initializeIcons } from '../icons/icons';
import { showModal, hideModal } from '../utils/modal-utils';
import { getMessage, translatePage } from '../utils/i18n';
import { debugLog } from '../utils/debug';
import { iconTile, CATALOG } from '../utils/provider-catalog';
import { openProviderPicker, openProviderEditor, openModelPicker } from './provider-dialogs';

export interface PresetProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKeyUrl?: string;
	apiKeyRequired?: boolean;
	modelsList?: string;
	signIn?: 'tokendance' | 'chatgpt' | 'codex';
	popularModels?: Array<{
		id: string;
		name: string;
		recommended?: boolean;
	}>;
}

interface ProviderPresets {
	version: string;
	[key: string]: PresetProvider | string;
}

const PROVIDERS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-clipper/refs/heads/main/providers.json';
const PRESET_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const PRESET_RETRY_DELAY = 60 * 1000; // 1 minute
const LOCAL_STORAGE_KEY = 'provider_presets';

let cachedPresets: Record<string, PresetProvider> | null = null;
let lastFetchTime = 0;
let lastErrorTime = 0;
let isFetching = false;

let cachedPresetProviders: Record<string, PresetProvider> | null = null;

async function fetchPresetProviders(): Promise<Record<string, PresetProvider>> {
	debugLog('Providers', 'Fetching preset providers from URL:', PROVIDERS_URL);
	try {
		const response = await fetch(PROVIDERS_URL);
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json() as ProviderPresets;
		
		await setLocalStorage(LOCAL_STORAGE_KEY, data);
		debugLog('Providers', 'Stored providers in local storage:', data);

		const providers: Record<string, PresetProvider> = {};
		for (const key in data) {
			if (key !== 'version' && Object.prototype.hasOwnProperty.call(data, key)) {
				const provider = data[key] as PresetProvider;
				provider.id = key;
				providers[key] = provider;
			}
		}

		debugLog('Providers', 'Successfully fetched presets:', providers);
		return providers;
	} catch (error) {
		console.error('Failed to fetch preset providers:', error);
		throw error;
	}
}

async function getLocalPresets(): Promise<Record<string, PresetProvider> | null> {
	try {
		const data = await getLocalStorage(LOCAL_STORAGE_KEY) as ProviderPresets | null;
		if (!data) return null;

		const providers: Record<string, PresetProvider> = {};
		for (const key in data) {
			if (key !== 'version' && Object.prototype.hasOwnProperty.call(data, key)) {
				const provider = data[key] as PresetProvider;
				provider.id = key;
				providers[key] = provider;
			}
		}
		return providers;
	} catch (error) {
		console.error('Failed to get providers from local storage:', error);
		return null;
	}
}

async function shouldUpdatePresets(): Promise<boolean> {
	try {
		const localData = await getLocalStorage(LOCAL_STORAGE_KEY) as ProviderPresets | null;
		
		const response = await fetch(PROVIDERS_URL);
		if (!response.ok) return false;
		
		const remoteData = await response.json() as ProviderPresets;
		const remoteVersion = remoteData.version;

		if (!localData) return true;
		const localVersion = localData.version;

		return localVersion !== remoteVersion; 
	} catch (error) {
		console.error('Failed to check provider versions:', error);
		return false;
	}
}

// Providers we ship ourselves (see provider-catalog); the upstream list only adds to them.
const BUILT_IN_PRESETS: Record<string, PresetProvider> = Object.fromEntries(CATALOG.map(e => [e.id, {
	id: e.id, name: e.name, baseUrl: e.baseUrl, apiKeyUrl: e.apiKeyUrl, apiKeyRequired: e.apiKeyRequired, modelsList: e.modelsList, signIn: e.signIn, popularModels: e.popularModels
}]));

export async function getPresetProviders(): Promise<Record<string, PresetProvider>> {
	const presets = await loadPresetProviders();
	return { ...presets, ...BUILT_IN_PRESETS };
}

async function loadPresetProviders(): Promise<Record<string, PresetProvider>> {
	const now = Date.now();

	if (cachedPresets && (now - lastFetchTime < PRESET_CACHE_DURATION)) {
		debugLog('Providers', 'Returning in-memory cached presets');
		return cachedPresets;
	}

	if (isFetching || (lastErrorTime > 0 && now - lastErrorTime < PRESET_RETRY_DELAY)) {
		debugLog('Providers', 'Fetching is already in progress or recently failed');
		const localPresets = await getLocalPresets();
		if (localPresets) {
			cachedPresets = localPresets;
		}
		debugLog('Providers', 'Returning fallback presets (local or previous cache)');
		return localPresets || cachedPresets || {};
	}

	isFetching = true;
	try {
		const needsUpdate = await shouldUpdatePresets();
		
		if (!needsUpdate) {
			const localPresets = await getLocalPresets();
			if (localPresets) {
				cachedPresets = localPresets;
				lastFetchTime = now;
				lastErrorTime = 0;
				debugLog('Providers', 'Using up-to-date local storage presets');
				return localPresets;
			}
			debugLog('Providers', 'Local presets missing despite version match or failed check, fetching fresh.');
		}

		debugLog('Providers', 'Fetching fresh presets from remote.');
		const presets = await fetchPresetProviders();
		cachedPresets = presets;
		lastFetchTime = now;
		lastErrorTime = 0;
		debugLog('Providers', 'Fetched and cached new presets');
		return cachedPresets;
	} catch (error) {
		console.error('Failed to load or cache preset providers:', error);
		lastErrorTime = now;
		
		const localPresets = await getLocalPresets();
		if (localPresets) {
			cachedPresets = localPresets;
		}
		debugLog('Providers', 'Fetch failed, returning fallback presets (local or previous cache)');
		return localPresets || cachedPresets || {};
	} finally {
		isFetching = false;
	}
}

export function updatePromptContextVisibility(): void {
	const interpreterToggle = document.getElementById('interpreter-toggle') as HTMLInputElement;
	const promptContextContainer = document.getElementById('prompt-context-container');
	const templateAdvancedSection = document.getElementById('template-advanced-section');
	const interpreterSection = document.getElementById('interpreter-section');

	if (promptContextContainer) {
		promptContextContainer.style.display = interpreterToggle.checked ? 'block' : 'none';
	}

	if (templateAdvancedSection) {
		templateAdvancedSection.style.display = interpreterToggle.checked ? 'block' : 'none';
	}

	if (interpreterSection) {
		interpreterSection.classList.toggle('is-disabled', !interpreterToggle.checked);
	}
}

export async function initializeInterpreterSettings(): Promise<void> {
	try {
		const interpreterSettingsForm = document.getElementById('interpreter-settings-form');
		if (interpreterSettingsForm) {
			interpreterSettingsForm.addEventListener('input', debounce(saveInterpreterSettingsFromForm, 500));
		}

		await loadSettings();
		debugLog('Interpreter', 'Loaded general settings:', generalSettings);

		// Ensure models and providers are valid arrays
		if (!Array.isArray(generalSettings.models)) {
			console.warn('Invalid models data, resetting to empty array');
			generalSettings.models = [];
		}
		if (!Array.isArray(generalSettings.providers)) {
			console.warn('Invalid providers data, resetting to empty array');
			generalSettings.providers = [];
		}

		cachedPresetProviders = await getPresetProviders();
		debugLog('Interpreter', 'Fetched preset providers:', cachedPresetProviders);

		// Initialize lists with error handling
		try {
			initializeProviderList();
		} catch (error) {
			console.error('Error initializing provider list:', error);
			generalSettings.providers = [];
		}

		try {
			initializeModelList();
		} catch (error) {
			console.error('Error initializing model list:', error);
			generalSettings.models = [];
		}

		initializeInterpreterToggles();

		const defaultPromptContextInput = document.getElementById('default-prompt-context') as HTMLTextAreaElement;
		if (defaultPromptContextInput) {
			defaultPromptContextInput.value = generalSettings.defaultPromptContext;
		}

		updatePromptContextVisibility();
		initializeToggles();
		initializeAutoSave();
		
		const addModelBtn = document.getElementById('add-model-btn');
		if (addModelBtn) {
			addModelBtn.addEventListener('click', (event) => addModelToList(event));
		}

		const addProviderBtn = document.getElementById('add-provider-btn');
		if (addProviderBtn) {
			addProviderBtn.addEventListener('click', (event) => addProviderToList(event));
		}
	} catch (error) {
		console.error('Error in initializeInterpreterSettings:', error);
		// Reset to safe defaults and re-throw to be handled by caller
		generalSettings.models = [];
		generalSettings.providers = [];
		generalSettings.interpreterEnabled = false;
		throw error;
	}
}

function initializeInterpreterToggles(): void {
	initializeSettingToggle('interpreter-toggle', generalSettings.interpreterEnabled, (checked) => {
		saveSettings({ ...generalSettings, interpreterEnabled: checked });
		updatePromptContextVisibility();
	});

	initializeSettingToggle('interpreter-auto-run-toggle', generalSettings.interpreterAutoRun, (checked) => {
		saveSettings({ ...generalSettings, interpreterAutoRun: checked });
	});
}

function initializeProviderList() {
	debugLog('Providers', 'Initializing provider list with:', generalSettings.providers);
	const providerList = document.getElementById('provider-list');
	if (!providerList) {
		console.error('Provider list element not found');
		return;
	}

	const sortedProviders = [...generalSettings.providers].filter(p => p).sort((a, b) => 
		a.name.toLowerCase().localeCompare(b.name.toLowerCase())
	);

	// Clear existing providers
	providerList.textContent = '';
	sortedProviders.forEach((provider, index) => {
		const originalIndex = generalSettings.providers.findIndex(p => p.id === provider.id);
		const providerItem = createProviderListItem(provider, originalIndex);
		providerList.appendChild(providerItem);
	});

	initializeIcons(providerList);
	debugLog('Providers', 'Provider list initialized');
}

function createProviderListItem(provider: Provider, index: number): HTMLElement {
	const item = document.createElement('div');
	item.className = 'provider-list-item';
	item.dataset.index = index.toString();
	item.dataset.providerId = provider.id;

	const info = document.createElement('div');
	info.className = 'provider-list-item-info';
	const text = document.createElement('div');
	text.className = 'provider-list-text';
	const name = document.createElement('div');
	name.className = 'provider-name-text';
	name.textContent = provider.name;
	const sub = document.createElement('div');
	sub.className = 'provider-list-sub';
	const needsKey = provider.apiKeyRequired !== false && !provider.apiKey && !provider.oauth;
	if (provider.oauth) sub.textContent = getMessage('providerSignInDone', provider.oauth.email || provider.name);
	else if (needsKey) { sub.textContent = getMessage('apiKeyMissing'); sub.classList.add('is-warn'); }
	else { try { sub.textContent = new URL(provider.baseUrl.replace(/[{}]/g, '')).host; } catch { sub.textContent = ''; } }
	text.append(name, sub);
	info.append(iconTile(provider, 'md'), text);

	const actions = document.createElement('div');
	actions.className = 'provider-list-item-actions';
	const iconButton = (cls: string, label: string, icon: string, run: () => void) => {
		const b = document.createElement('button');
		b.className = `${cls} clickable-icon`;
		b.setAttribute('aria-label', label);
		const i = document.createElement('i');
		i.setAttribute('data-lucide', icon);
		b.appendChild(i);
		b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
		return b;
	};
	actions.append(
		iconButton('edit-provider-btn', getMessage('pdEdit'), 'pen-line', () => { const i = generalSettings.providers.findIndex(p => p.id === provider.id); if (i !== -1) editProvider(i); }),
		iconButton('delete-provider-btn', getMessage('pdDelete'), 'trash-2', () => { const i = generalSettings.providers.findIndex(p => p.id === provider.id); if (i !== -1) deleteProvider(i); })
	);
	item.append(info, actions);
	return item;
}

const refreshLists = () => { initializeProviderList(); initializeModelList(); };

function addProviderToList(event: Event) {
	event.preventDefault();
	openProviderPicker(cachedPresetProviders || {}, refreshLists);
}

function editProvider(index: number) {
	openProviderEditor(generalSettings.providers[index], cachedPresetProviders || {}, refreshLists);
}

function deleteProvider(index: number): void {
	const providerToDelete = generalSettings.providers[index];
	
	const modelsUsingProvider = generalSettings.models.filter(m => m.providerId === providerToDelete.id);
	if (modelsUsingProvider.length > 0) {
		alert(getMessage('cannotDeleteProvider', [providerToDelete.name, modelsUsingProvider.length.toString()]));
		return;
	}

	if (confirm(getMessage('deleteProviderConfirm'))) {
		generalSettings.providers.splice(index, 1);
		saveSettings();
		initializeProviderList();
	}
}

export function initializeModelList() {
	const modelList = document.getElementById('model-list');
	if (!modelList) return;

	// Clear existing models
	modelList.textContent = '';
	const sortedModels = [...generalSettings.models].filter(m => m).sort((a, b) => 
		a.name.toLowerCase().localeCompare(b.name.toLowerCase())
	);
	
	sortedModels.forEach((model) => {
		const originalIndex = generalSettings.models.findIndex(m => m.id === model.id);
		if (originalIndex !== -1) {
			const modelItem = createModelListItem(model, originalIndex);
			modelList.appendChild(modelItem);
		}
	});

	initializeIcons(modelList);
}

function createModelListItem(model: ModelConfig, index: number): HTMLElement {
	const item = document.createElement('div');
	item.className = 'model-list-item';
	item.draggable = true;
	item.dataset.index = index.toString();
	item.dataset.modelId = model.id;
	const provider = generalSettings.providers.find(p => p.id === model.providerId);

	const grip = document.createElement('div');
	grip.className = 'drag-handle';
	const gripIcon = document.createElement('i');
	gripIcon.setAttribute('data-lucide', 'grip-vertical');
	grip.appendChild(gripIcon);

	const info = document.createElement('div');
	info.className = 'model-list-item-info';
	const text = document.createElement('div');
	text.className = 'model-list-text';
	const name = document.createElement('div');
	name.className = 'model-name';
	name.textContent = model.name;
	const sub = document.createElement('div');
	sub.className = 'model-provider mh';
	sub.textContent = provider?.name || getMessage('unknownProvider');
	text.append(name, sub);
	info.append(iconTile(provider || {}, 'md'), text);

	const actions = document.createElement('div');
	actions.className = 'model-list-item-actions';
	const iconButton = (cls: string, label: string, icon: string, run: () => void) => {
		const b = document.createElement('button');
		b.className = `${cls} clickable-icon`;
		b.setAttribute('aria-label', label);
		const i = document.createElement('i');
		i.setAttribute('data-lucide', icon);
		b.appendChild(i);
		b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
		return b;
	};
	const find = () => generalSettings.models.findIndex(m => m.id === model.id);
	const checkboxContainer = document.createElement('div');
	checkboxContainer.className = 'checkbox-container mod-small';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.id = `model-${model.id}`;
	checkbox.checked = model.enabled;
	checkbox.setAttribute('aria-label', model.name);
	checkboxContainer.appendChild(checkbox);
	actions.append(
		iconButton('edit-model-btn', getMessage('pdEdit'), 'pen-line', () => { const i = find(); if (i !== -1) editModel(i); }),
		iconButton('duplicate-model-btn', getMessage('pdDuplicate'), 'copy-plus', () => { const i = find(); if (i !== -1) duplicateModel(i); }),
		iconButton('delete-model-btn', getMessage('pdDelete'), 'trash-2', () => { const i = find(); if (i !== -1) deleteModel(i); }),
		checkboxContainer
	);
	item.append(grip, info, actions);

	initializeToggles(item);
	checkbox.addEventListener('change', () => {
		const i = find();
		if (i !== -1) { generalSettings.models[i].enabled = checkbox.checked; saveSettings(); }
	});
	initializeIcons(item);
	return item;
}

function addModelToList(event: Event) {
	event.preventDefault();
	openModelPicker(refreshLists, () => openProviderPicker(cachedPresetProviders || {}, refreshLists));
}

function editModel(index: number) {
	openModelPicker(refreshLists, () => openProviderPicker(cachedPresetProviders || {}, refreshLists), generalSettings.models[index]);
}

function deleteModel(index: number) {
	if (confirm(getMessage('deleteModelConfirm'))) {
		generalSettings.models.splice(index, 1);
		saveSettings();
		initializeModelList();
	}
}

function initializeAutoSave(): void {
	const interpreterSettingsForm = document.getElementById('interpreter-settings-form');
	if (interpreterSettingsForm) {
		interpreterSettingsForm.addEventListener('input', debounce(saveInterpreterSettingsFromForm, 500));
	}
}

function saveInterpreterSettingsFromForm(): void {
	const interpreterToggle = document.getElementById('interpreter-toggle') as HTMLInputElement;
	const interpreterAutoRunToggle = document.getElementById('interpreter-auto-run-toggle') as HTMLInputElement;
	const defaultPromptContextInput = document.getElementById('default-prompt-context') as HTMLTextAreaElement;

	const updatedSettings: Partial<typeof generalSettings> = {}; 
	if (interpreterToggle) {
		updatedSettings.interpreterEnabled = interpreterToggle.checked;
	}
	if (interpreterAutoRunToggle) {
		updatedSettings.interpreterAutoRun = interpreterAutoRunToggle.checked;
	}
	if (defaultPromptContextInput) {
		updatedSettings.defaultPromptContext = defaultPromptContextInput.value;
	}

	if (Object.keys(updatedSettings).length > 0) {
		saveSettings(updatedSettings);
	}
}

function debounce(func: Function, delay: number): (...args: any[]) => void {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	return (...args: any[]) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => func(...args), delay);
	};
}

function duplicateModel(index: number) {
	const source = generalSettings.models[index];
	const copy: ModelConfig = { ...source, id: Date.now().toString(), name: `${source.name} (copy)` };
	generalSettings.models.splice(index + 1, 0, copy);
	saveSettings();
	initializeModelList();
	openModelPicker(refreshLists, () => {}, copy);
}
