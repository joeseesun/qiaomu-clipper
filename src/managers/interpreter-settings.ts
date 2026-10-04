import { initializeToggles, initializeSettingToggle } from '../utils/ui-utils';
import { ModelConfig, Provider } from '../types/types';
import { generalSettings, loadSettings, saveSettings, getLocalStorage, setLocalStorage } from '../utils/storage-utils';
import { initializeIcons } from '../icons/icons';
import { showModal, hideModal } from '../utils/modal-utils';
import { getMessage, translatePage } from '../utils/i18n';
import { debugLog } from '../utils/debug';
import { fetchProviderModels } from '../utils/provider-models';
import { translationLanguages, validTargetLanguage } from '../utils/translation-languages';

export interface PresetProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKeyUrl?: string;
	apiKeyRequired?: boolean;
	modelsList?: string;
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

export async function getPresetProviders(): Promise<Record<string, PresetProvider>> {
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

	interpreterSection?.classList.remove('is-disabled');
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
		initializeModelAssignments();

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
	const providerItem = document.createElement('div');
	providerItem.className = 'provider-list-item';
	providerItem.dataset.index = index.toString();
	providerItem.dataset.providerId = provider.id;

	const presetProvider = Object.values(cachedPresetProviders || {}).find(
		preset => preset.name === provider.name
	);

	const hasNoKey = presetProvider?.apiKeyRequired && !provider.apiKey;

	// Create provider list item info container
	const providerListItemInfo = document.createElement('div');
	providerListItemInfo.className = 'provider-list-item-info';
	
	// Create provider name container
	const providerName = document.createElement('div');
	providerName.className = 'provider-name';
	
	// Create provider icon container
	const providerIconContainer = document.createElement('div');
	providerIconContainer.className = 'provider-icon-container';
	const providerIconSpan = document.createElement('span');
	providerIconSpan.className = `provider-icon icon-${provider.name.toLowerCase().replace(/\s+/g, '-')}`;
	providerIconContainer.appendChild(providerIconSpan);
	
	// Create provider name text
	const providerNameText = document.createElement('div');
	providerNameText.className = 'provider-name-text';
	providerNameText.textContent = provider.name;
	
	providerName.appendChild(providerIconContainer);
	providerName.appendChild(providerNameText);
	providerListItemInfo.appendChild(providerName);
	
	// Add no-key warning if needed
	if (hasNoKey) {
		const providerNoKey = document.createElement('span');
		providerNoKey.className = 'provider-no-key';
		
		const alertIcon = document.createElement('i');
		alertIcon.setAttribute('data-lucide', 'alert-triangle');
		providerNoKey.appendChild(alertIcon);
		
		providerNoKey.appendChild(document.createTextNode(' '));
		
		const messageSpan = document.createElement('span');
		messageSpan.className = 'mh';
		messageSpan.textContent = getMessage('apiKeyMissing');
		providerNoKey.appendChild(messageSpan);
		
		providerListItemInfo.appendChild(providerNoKey);
	}
	
	// Create provider list item actions container
	const providerListItemActions = document.createElement('div');
	providerListItemActions.className = 'provider-list-item-actions';
	
	// Create edit button
	const editProviderBtn = document.createElement('button');
	editProviderBtn.className = 'edit-provider-btn clickable-icon';
	editProviderBtn.setAttribute('data-provider-id', provider.id);
	editProviderBtn.setAttribute('aria-label', 'Edit provider');
	const editIcon = document.createElement('i');
	editIcon.setAttribute('data-lucide', 'pen-line');
	editProviderBtn.appendChild(editIcon);
	
	// Create delete button
	const deleteProviderBtn = document.createElement('button');
	deleteProviderBtn.className = 'delete-provider-btn clickable-icon';
	deleteProviderBtn.setAttribute('data-provider-id', provider.id);
	deleteProviderBtn.setAttribute('aria-label', 'Delete provider');
	const deleteIcon = document.createElement('i');
	deleteIcon.setAttribute('data-lucide', 'trash-2');
	deleteProviderBtn.appendChild(deleteIcon);
	
	providerListItemActions.appendChild(editProviderBtn);
	providerListItemActions.appendChild(deleteProviderBtn);
	
	// Assemble provider item
	providerItem.appendChild(providerListItemInfo);
	providerItem.appendChild(providerListItemActions);

	// Add event listeners using direct element references
	editProviderBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const providerId = editProviderBtn.getAttribute('data-provider-id');
		if (providerId) {
			const providerIndex = generalSettings.providers.findIndex(p => p.id === providerId);
			if (providerIndex !== -1) {
				editProvider(providerIndex);
			}
		}
	});

	deleteProviderBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const providerId = deleteProviderBtn.getAttribute('data-provider-id');
		if (providerId) {
			const providerIndex = generalSettings.providers.findIndex(p => p.id === providerId);
			if (providerIndex !== -1) {
				deleteProvider(providerIndex);
			}
		}
	});

	return providerItem;
}

function addProviderToList(event: Event) {
	event.preventDefault();
	debugLog('Providers', 'Adding new provider');
	const newProvider: Provider = {
		id: Date.now().toString(),
		name: '',
		baseUrl: '',
		apiKey: ''
	};
	showProviderModal(newProvider);
}

function editProvider(index: number) {
	const providerToEdit = generalSettings.providers[index];
	showProviderModal(providerToEdit, index);
}

function duplicateProvider(index: number) {
	const providerToDuplicate = generalSettings.providers[index];
	const duplicatedProvider: Provider = {
		...providerToDuplicate,
		id: Date.now().toString(),
		name: `${providerToDuplicate.name} (copy)`,
		apiKey: ''
	};

	generalSettings.providers.push(duplicatedProvider);
	saveSettings();
	initializeProviderList();

	const newIndex = generalSettings.providers.length - 1;
	showProviderModal(duplicatedProvider, newIndex);
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

async function showProviderModal(provider: Provider, index?: number) {
	debugLog('Providers', 'Showing provider modal:', { provider, index });
	const modal = document.getElementById('provider-modal');
	if (!modal) return;

	if (!cachedPresetProviders) {
		cachedPresetProviders = await getPresetProviders();
	}

	await translatePage();
	initializeIcons(modal);

	const titleElement = modal.querySelector('.modal-title');
	if (titleElement) {
		titleElement.setAttribute('data-i18n', index !== undefined ? 'editProvider' : 'addProviderTitle');
	}

	const form = modal.querySelector('#provider-form') as HTMLFormElement;
	if (form) {
		const nameInput = form.querySelector('[name="name"]') as HTMLInputElement;
		const baseUrlInput = form.querySelector('[name="baseUrl"]') as HTMLInputElement;
		const apiKeyInput = form.querySelector('[name="apiKey"]') as HTMLInputElement;
		const presetSelect = form.querySelector('[name="preset"]') as HTMLSelectElement;
		const nameContainer = nameInput.closest('.setting-item') as HTMLElement;
		const apiKeyContainer = apiKeyInput.closest('.setting-item') as HTMLElement;
		const apiKeyDescription = form.querySelector('.setting-item:has([name="apiKey"]) .setting-item-description') as HTMLElement;

		if (!apiKeyContainer || !apiKeyDescription || !nameContainer || !presetSelect || !nameInput || !baseUrlInput || !apiKeyInput) {
			console.error('Required provider modal elements not found');
			return;
		}

		// Clear and populate preset select
		presetSelect.textContent = '';
		
		// Add custom option
		const customOption = document.createElement('option');
		customOption.value = '';
		customOption.textContent = getMessage('custom');
		presetSelect.appendChild(customOption);
		
		// Add preset options
		Object.entries(cachedPresetProviders || {}).forEach(([id, preset]) => {
			const option = document.createElement('option');
			option.value = id;
			option.textContent = preset.name;
			presetSelect.appendChild(option);
		});

		nameInput.value = '';
		baseUrlInput.value = '';
		apiKeyInput.value = '';
		presetSelect.value = '';

		let currentPresetId: string | null = null;
		if (index !== undefined) {
			nameInput.value = provider.name;
			baseUrlInput.value = provider.baseUrl;
			apiKeyInput.value = provider.apiKey;

			const matchingPreset = Object.entries(cachedPresetProviders || {}).find(([_, p]) => p.baseUrl === provider.baseUrl);
			currentPresetId = matchingPreset ? matchingPreset[0] : null;
			
			if (!currentPresetId) {
				const nameMatchingPreset = Object.entries(cachedPresetProviders || {}).find(([_, p]) => p.name === provider.name);
				currentPresetId = nameMatchingPreset ? nameMatchingPreset[0] : null;
			}
			
			presetSelect.value = currentPresetId || '';
		} else {
			const anthropicPreset = Object.entries(cachedPresetProviders || {}).find(([_, p]) => p.name === 'Anthropic');
			presetSelect.value = anthropicPreset ? anthropicPreset[0] : '';
		}

		const updateVisibility = () => {
			const selectedPresetId = presetSelect.value;
			const selectedPreset = selectedPresetId ? (cachedPresetProviders || {})[selectedPresetId] : null;

			nameContainer.style.display = selectedPreset ? 'none' : 'block';
			
			if (selectedPreset) {
				nameInput.value = selectedPreset.name;
				
				const editingOriginalPreset = index !== undefined && selectedPresetId === currentPresetId;
				baseUrlInput.value = editingOriginalPreset ? provider.baseUrl : selectedPreset.baseUrl;
				apiKeyInput.value = editingOriginalPreset ? provider.apiKey : '';

				apiKeyContainer.style.display = selectedPreset.apiKeyRequired === false ? 'none' : 'block';

				if (selectedPreset.apiKeyRequired !== false && selectedPreset.apiKeyUrl) {
					const message = getMessage('getApiKeyHere').replace('$1', selectedPreset.name);
					apiKeyDescription.textContent = getMessage('providerApiKeyDescription') + ' ';
					const linkElement = document.createElement('a');
					linkElement.href = selectedPreset.apiKeyUrl;
					linkElement.target = '_blank';
					linkElement.textContent = message;
					apiKeyDescription.appendChild(linkElement);
				} else {
					apiKeyDescription.textContent = getMessage('providerApiKeyDescription');
				}
			} else {
				if (index === undefined || (index !== undefined && currentPresetId)) {
					nameInput.value = '';
					baseUrlInput.value = '';
					apiKeyInput.value = '';
				} else if (index !== undefined && !currentPresetId) {
					nameInput.value = provider.name;
					baseUrlInput.value = provider.baseUrl;
					apiKeyInput.value = provider.apiKey;
				}
				
				apiKeyContainer.style.display = 'block';
				apiKeyDescription.textContent = getMessage('providerApiKeyDescription');
			}
		};

		presetSelect.addEventListener('change', updateVisibility);
		updateVisibility();
	}

	const confirmBtn = modal.querySelector('.provider-confirm-btn');
	const cancelBtn = modal.querySelector('.provider-cancel-btn');

	const newConfirmBtn = confirmBtn?.cloneNode(true);
	const newCancelBtn = cancelBtn?.cloneNode(true);
	if (confirmBtn && newConfirmBtn) {
		confirmBtn.parentNode?.replaceChild(newConfirmBtn, confirmBtn);
	}
	if (cancelBtn && newCancelBtn) {
		cancelBtn.parentNode?.replaceChild(newCancelBtn, cancelBtn);
	}

	newConfirmBtn?.addEventListener('click', async () => {
		const formData = new FormData(form);
		const name = formData.get('name') as string;
		const baseUrl = formData.get('baseUrl') as string;
		const apiKey = formData.get('apiKey') as string;
		const presetId = (form.querySelector('[name="preset"]') as HTMLSelectElement).value;
		
		const updatedProvider: Provider = {
			id: provider.id,
			name: name,
			baseUrl: baseUrl,
			apiKey: apiKey,
			apiKeyRequired: true
		};

		debugLog('Providers', 'Saving provider:', updatedProvider);

		if (!updatedProvider.name || !updatedProvider.baseUrl) {
			alert(getMessage('providerRequiredFields'));
			return;
		}

		if (presetId && cachedPresetProviders && cachedPresetProviders[presetId]) {
			const providerPreset = cachedPresetProviders[presetId];
			
			updatedProvider.name = providerPreset.name;
			
			const providerPresetBaseUrl = providerPreset.baseUrl;
			// Use the user-provided baseUrl if it's different from the preset baseUrl
			updatedProvider.baseUrl = baseUrl !== providerPresetBaseUrl ? baseUrl : providerPresetBaseUrl;
			updatedProvider.apiKeyRequired = providerPreset.apiKeyRequired !== false;
		}

		if (index !== undefined) {
			generalSettings.providers[index] = updatedProvider;
		} else {
			generalSettings.providers.push(updatedProvider);
		}

		debugLog('Providers', 'Updated providers list:', generalSettings.providers);

		try {
			await saveSettings();
			debugLog('Providers', 'Settings saved');
			initializeProviderList();
			hideModal(modal);
		} catch (error) {
			console.error('Failed to save settings:', error);
			alert(getMessage('failedToSaveProvider'));
		}
	});

	newCancelBtn?.addEventListener('click', () => {
		hideModal(modal);
	});

	showModal(modal);
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
	refreshModelAssignments();
}

export function refreshModelAssignments(): void {
	for (const [id, setting] of [['answer-model-select', 'interpreterModel'], ['translation-model-select', 'translationModel']] as const) {
		const select = document.getElementById(id) as HTMLSelectElement | null;
		if (!select) continue;
		select.replaceChildren(new Option(getMessage('qiaomuSelectModel'), ''));
		for (const model of generalSettings.models.filter(item => item.enabled && generalSettings.providers.some(provider => provider.id === item.providerId))) {
			const provider = generalSettings.providers.find(item => item.id === model.providerId);
			select.add(new Option(`${model.name} · ${provider?.name || ''}`, model.id));
		}
		const selected = generalSettings[setting];
		if (selected && !Array.from(select.options).some(option => option.value === selected)) {
			const option = new Option(`${selected} (${getMessage('qiaomuModelUnavailable')})`, selected); option.disabled = true; select.add(option);
		}
		select.value = selected || '';
	}
}

function initializeModelAssignments(): void {
	refreshModelAssignments();
	for (const [id, setting] of [['answer-model-select', 'interpreterModel'], ['translation-model-select', 'translationModel']] as const) {
		const select = document.getElementById(id) as HTMLSelectElement | null;
		if (select) select.onchange = () => { void saveSettings({ [setting]: select.value }); };
	}
	const target = document.getElementById('translation-target-select') as HTMLSelectElement | null;
	if (target) {
		target.replaceChildren(...translationLanguages.map(item => new Option(item.label, item.code)));
		target.value = validTargetLanguage(generalSettings.translationTargetLanguage);
		target.onchange = () => { void saveSettings({ translationTargetLanguage: target.value }); };
	}
}

function createModelListItem(model: ModelConfig, index: number): HTMLElement {
	const modelItem = document.createElement('div');
	modelItem.className = 'model-list-item';
	modelItem.draggable = true;
	modelItem.dataset.index = index.toString();
	modelItem.dataset.modelId = model.id;

	const provider = generalSettings.providers.find(p => p.id === model.providerId);

	// Create drag handle
	const dragHandle = document.createElement('div');
	dragHandle.className = 'drag-handle';
	const gripIcon = document.createElement('i');
	gripIcon.setAttribute('data-lucide', 'grip-vertical');
	dragHandle.appendChild(gripIcon);
	
	// Create model list item info
	const modelListItemInfo = document.createElement('div');
	modelListItemInfo.className = 'model-list-item-info';
	
	const modelNameDiv = document.createElement('div');
	modelNameDiv.className = 'model-name';
	modelNameDiv.textContent = model.name;
	
	const modelProviderDiv = document.createElement('div');
	modelProviderDiv.className = 'model-provider mh';
	
	// Handle provider name with potential HTML content
	if (provider?.name) {
		modelProviderDiv.textContent = provider.name;
	} else {
		// Create unknown provider warning
		const alertIcon = document.createElement('i');
		alertIcon.setAttribute('data-lucide', 'alert-triangle');
		modelProviderDiv.appendChild(alertIcon);
		modelProviderDiv.appendChild(document.createTextNode(' ' + getMessage('unknownProvider')));
	}
	
	modelListItemInfo.appendChild(modelNameDiv);
	modelListItemInfo.appendChild(modelProviderDiv);
	
	// Create model list item actions
	const modelListItemActions = document.createElement('div');
	modelListItemActions.className = 'model-list-item-actions';
	
	// Create edit button
	const editModelBtn = document.createElement('button');
	editModelBtn.className = 'edit-model-btn clickable-icon';
	editModelBtn.setAttribute('data-model-id', model.id);
	editModelBtn.setAttribute('aria-label', 'Edit model');
	const editIcon = document.createElement('i');
	editIcon.setAttribute('data-lucide', 'pen-line');
	editModelBtn.appendChild(editIcon);
	
	// Create duplicate button
	const duplicateModelBtn = document.createElement('button');
	duplicateModelBtn.className = 'duplicate-model-btn clickable-icon';
	duplicateModelBtn.setAttribute('data-model-id', model.id);
	duplicateModelBtn.setAttribute('aria-label', 'Duplicate model');
	const duplicateIcon = document.createElement('i');
	duplicateIcon.setAttribute('data-lucide', 'copy-plus');
	duplicateModelBtn.appendChild(duplicateIcon);
	
	// Create delete button
	const deleteModelBtn = document.createElement('button');
	deleteModelBtn.className = 'delete-model-btn clickable-icon';
	deleteModelBtn.setAttribute('data-model-id', model.id);
	deleteModelBtn.setAttribute('aria-label', 'Delete model');
	const deleteIcon = document.createElement('i');
	deleteIcon.setAttribute('data-lucide', 'trash-2');
	deleteModelBtn.appendChild(deleteIcon);
	
	// Create checkbox container
	const checkboxContainer = document.createElement('div');
	checkboxContainer.className = 'checkbox-container mod-small';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.id = `model-${model.id}`;
	checkbox.checked = model.enabled;
	checkboxContainer.appendChild(checkbox);
	
	// Assemble actions
	modelListItemActions.appendChild(editModelBtn);
	modelListItemActions.appendChild(duplicateModelBtn);
	modelListItemActions.appendChild(deleteModelBtn);
	modelListItemActions.appendChild(checkboxContainer);
	
	// Assemble model item
	modelItem.appendChild(dragHandle);
	modelItem.appendChild(modelListItemInfo);
	modelItem.appendChild(modelListItemActions);

	// Add event listeners using direct element references
	initializeToggles(modelItem);
	checkbox.addEventListener('change', () => {
		const modelIndex = generalSettings.models.findIndex(m => m.id === model.id);
		if (modelIndex !== -1) {
			generalSettings.models[modelIndex].enabled = checkbox.checked;
			saveSettings();
			refreshModelAssignments();
		}
	});

	duplicateModelBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const modelId = duplicateModelBtn.getAttribute('data-model-id');
		const modelIndex = generalSettings.models.findIndex(m => m.id === modelId);
		if (modelIndex !== -1) {
			duplicateModel(modelIndex);
		}
	});

	editModelBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const modelId = editModelBtn.getAttribute('data-model-id');
		const modelIndex = generalSettings.models.findIndex(m => m.id === modelId);
		if (modelIndex !== -1) {
			editModel(modelIndex);
		}
	});

	deleteModelBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const modelId = deleteModelBtn.getAttribute('data-model-id');
		const modelIndex = generalSettings.models.findIndex(m => m.id === modelId);
		if (modelIndex !== -1) {
			deleteModel(modelIndex);
		}
	});

	initializeIcons(modelItem);

	return modelItem;
}

function addModelToList(event: Event) {
	event.preventDefault();
	const newModel: ModelConfig = {
		id: Date.now().toString(),
		providerId: '',
		providerModelId: '',
		name: '',
		enabled: true
	};
	showModelModal(newModel);
}

function editModel(index: number) {
	const modelToEdit = generalSettings.models[index];
	showModelModal(modelToEdit, index);
}

async function showModelModal(model: ModelConfig, index?: number) {
	debugLog('Models', 'Showing model modal:', { model, index });
	const modal = document.getElementById('model-modal');
	if (!modal) return;

	if (!cachedPresetProviders) {
		cachedPresetProviders = await getPresetProviders();
	}

	await translatePage();
	initializeIcons(modal);

	const titleElement = modal.querySelector('.modal-title');
	if (titleElement) {
		titleElement.setAttribute('data-i18n', index !== undefined ? 'editModel' : 'addModelTitle');
	}

	const form = modal.querySelector('#model-form') as HTMLFormElement;
	if (form) {
		const providerSelect = form.querySelector('[name="providerId"]') as HTMLSelectElement;
		const modelIdDescriptionContainer = form.querySelector('.setting-item:has([name="providerModelId"]) .setting-item-description') as HTMLElement;
		const modelSelectionContainer = form.querySelector('.model-selection-container') as HTMLElement;
		const modelSelectionRadios = form.querySelector('#model-selection-radios') as HTMLElement;
		const nameInput = form.querySelector('[name="name"]') as HTMLInputElement;
		const providerModelIdInput = form.querySelector('[name="providerModelId"]') as HTMLInputElement;

		if (!modelIdDescriptionContainer || !modelSelectionContainer || !modelSelectionRadios || !nameInput || !providerModelIdInput || !providerSelect) {
			console.error('Required model modal form elements not found');
			return;
		}

		// Clear existing provider options
		providerSelect.textContent = '';
		const defaultOption = document.createElement('option');
		defaultOption.value = '';
		defaultOption.textContent = getMessage('selectProvider');
		defaultOption.disabled = true;
		defaultOption.selected = true;
		providerSelect.appendChild(defaultOption);

		const sortedProviders = [...generalSettings.providers].filter(p => p).sort((a, b) => 
			a.name.toLowerCase().localeCompare(b.name.toLowerCase())
		);
		sortedProviders.forEach(provider => {
			const option = document.createElement('option');
			option.value = provider.id;
			option.textContent = provider.name;
			providerSelect.appendChild(option);
		});

		nameInput.value = '';
		providerModelIdInput.value = '';
		nameInput.disabled = true;
		providerModelIdInput.disabled = true;
		modelSelectionContainer.style.display = 'none';
		// Clear model selection radios
		modelSelectionRadios.textContent = '';
		modelIdDescriptionContainer.textContent = getMessage('providerModelIdDescription');

		let requestController: AbortController | undefined;
		let requestVersion = 0;
		const updateModelOptions = async (refresh = false) => {
			requestController?.abort();
			requestController = new AbortController();
			const version = ++requestVersion;
			const provider = generalSettings.providers.find(p => p.id === providerSelect.value);
			if (!refresh) {
				const editing = index !== undefined && model.providerId === providerSelect.value;
				nameInput.value = editing ? model.name : '';
				providerModelIdInput.value = editing ? model.providerModelId || '' : '';
			}
			nameInput.disabled = !provider;
			providerModelIdInput.disabled = !provider;
			providerModelIdInput.oninput = null;
			modelSelectionRadios.textContent = '';
			modelSelectionContainer.style.display = provider ? 'block' : 'none';
			modelIdDescriptionContainer.textContent = getMessage('providerModelIdDescription');
			if (!provider) return;

			const preset = cachedPresetProviders && (cachedPresetProviders[provider.presetId || ''] || Object.values(cachedPresetProviders).find(p => p.name === provider.name));
			if (preset?.modelsList) {
				const link = document.createElement('a');
				link.href = preset.modelsList;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				link.textContent = getMessage('modelsListFor', provider.name);
				modelIdDescriptionContainer.append(' ', link);
			}

			const status = document.createElement('div');
			status.className = 'setting-item-description';
			status.setAttribute('role', 'status');
			status.textContent = getMessage('providerModelsLoading');
			const select = document.createElement('select');
			select.id = 'provider-model-select';
			select.setAttribute('aria-label', getMessage('providerModels'));
			const custom = document.createElement('option');
			custom.value = '';
			custom.textContent = getMessage('custom');
			select.appendChild(custom);
			select.disabled = true;
			const refreshButton = document.createElement('button');
			refreshButton.type = 'button';
			refreshButton.className = 'clickable-icon';
			refreshButton.title = getMessage('providerModelsRefresh');
			refreshButton.setAttribute('aria-label', refreshButton.title);
			const icon = document.createElement('i');
			icon.setAttribute('data-lucide', 'refresh-cw');
			refreshButton.appendChild(icon);
			refreshButton.onclick = () => { void updateModelOptions(true); };
			modelSelectionRadios.append(select, refreshButton, status);
			initializeIcons(modelSelectionRadios);
			try {
				const available = await fetchProviderModels(provider, requestController.signal);
				if (version !== requestVersion) return;
				for (const item of available) {
					const option = document.createElement('option');
					option.value = item.id;
					option.textContent = item.name === item.id ? item.id : `${item.name} (${item.id})`;
					select.appendChild(option);
				}
				select.disabled = false;
				select.value = available.some(m => m.id === providerModelIdInput.value) ? providerModelIdInput.value : '';
				status.textContent = available.length ? '' : getMessage('providerModelsEmpty');
				providerModelIdInput.oninput = () => {
					select.value = available.some(m => m.id === providerModelIdInput.value) ? providerModelIdInput.value : '';
				};
				select.onchange = () => {
					const selected = available.find(m => m.id === select.value);
					nameInput.value = selected?.name || '';
					providerModelIdInput.value = selected?.id || '';
				};
			} catch (error) {
				if (version !== requestVersion) return;
				select.disabled = false;
				const reason = error instanceof Error ? error.message : '';
				status.textContent = getMessage(reason === 'missing-api-key' ? 'providerModelsMissingKey' : reason === 'deployment-models' ? 'providerModelsDeployment' : 'providerModelsFailed');
			}
		};

		// Assign handlers so reopening this modal does not accumulate listeners.
		providerSelect.onchange = () => { void updateModelOptions(); };

		if (index !== undefined) {
			providerSelect.value = model.providerId;
			updateModelOptions(); 
			nameInput.value = model.name;
			providerModelIdInput.value = model.providerModelId || '';
		} else {
			if (sortedProviders.length > 0) {
				// Maybe default to first provider? Or leave blank? Let's leave blank for now.
				// providerSelect.value = sortedProviders[0].id; 
				// updateModelOptions();
			} else {
				console.warn("No providers configured. Cannot add models.");
				// Consider disabling the confirm button or showing a message.
			}
		}

		translatePage();

		const confirmBtn = modal.querySelector('.model-confirm-btn');
		const cancelBtn = modal.querySelector('.model-cancel-btn');

		if (!confirmBtn || !cancelBtn) {
			console.error('Modal buttons not found');
			return;
		}

		const newConfirmBtn = confirmBtn.cloneNode(true);
		const newCancelBtn = cancelBtn.cloneNode(true);
		confirmBtn.parentNode?.replaceChild(newConfirmBtn, confirmBtn);
		cancelBtn.parentNode?.replaceChild(newCancelBtn, cancelBtn);

		newConfirmBtn.addEventListener('click', async () => {
			const formData = new FormData(form);
			const selectedProviderId = formData.get('providerId') as string;
			
			let updatedModel: ModelConfig = {
				id: model.id,
				providerId: selectedProviderId,
				providerModelId: '',
				name: '',
				enabled: model.enabled
			};

			updatedModel.name = formData.get('name') as string;
			updatedModel.providerModelId = formData.get('providerModelId') as string;

			if (!updatedModel.name || !updatedModel.providerId || !updatedModel.providerModelId) {
				alert(getMessage('modelRequiredFields'));
				return;
			}

			if (index !== undefined) {
				generalSettings.models[index] = updatedModel;
			} else {
				generalSettings.models.push(updatedModel);
			}

			try {
				await saveSettings();
				initializeModelList();
				hideModal(modal);
			} catch (error) {
				console.error('Failed to save model settings:', error);
				alert(getMessage('failedToSaveModel'));
			}
		});

		newCancelBtn?.addEventListener('click', () => {
			hideModal(modal);
		});

		showModal(modal);
	}
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
	const modelToDuplicate = generalSettings.models[index];
	const duplicatedModel: ModelConfig = {
		...modelToDuplicate,
		id: Date.now().toString(),
		name: `${modelToDuplicate.name} (copy)`
	};

	generalSettings.models.splice(index + 1, 0, duplicatedModel); 
	
	saveSettings();
	initializeModelList();

	const newIndex = index + 1;
	showModelModal(duplicatedModel, newIndex);
}
