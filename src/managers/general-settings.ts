import { handleDragStart, handleDragOver, handleDrop, handleDragEnd } from '../utils/drag-and-drop';
import { initializeIcons } from '../icons/icons';
import { getCommands } from '../utils/hotkeys';
import { initializeToggles, updateToggleState, initializeSettingToggle } from '../utils/ui-utils';
import { generalSettings, loadSettings, saveSettings, setLocalStorage, getLocalStorage } from '../utils/storage-utils';
import { detectBrowser } from '../utils/browser-detection';
import { createElementWithClass, createElementWithHTML } from '../utils/dom-utils';
import { createDefaultTemplate, getTemplates, saveTemplateSettings } from '../managers/template-manager';
import { updateTemplateList, showTemplateEditor } from '../managers/template-ui';
import { exportAllSettings, importAllSettings } from '../utils/import-export';
import { Settings, Template } from '../types/types';
import { exportHighlights, importHighlights } from './highlights-manager';
import { getMessage, setupLanguageAndDirection } from '../utils/i18n';
import { debounce } from '../utils/debounce';
import { initializeAsrSettings } from './asr-settings';
import { initializeStudySitesSettings } from './study-sites-settings';
import { initializeStudyHome } from './study-home-settings';
import browser from '../utils/browser-polyfill';
import { createUsageChart, aggregateUsageData, UsageMetric } from '../utils/charts';
import { getClipHistory } from '../utils/storage-utils';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { showModal, hideModal } from '../utils/modal-utils';
import { LocalSaveResult } from '../utils/local-save';
import { describeHelperFailure, nativeHelperRepairPrompt } from '../utils/native-helper-prompt';
import { DEFAULT_TRIPLE_KEYS, TRIPLE_COMMANDS, TripleCommand, normalizeTripleKeys, normalizeSites } from '../utils/triple-key';

dayjs.extend(weekOfYear);

export function updateVaultList(): void {
	const vaultList = document.getElementById('vault-list') as HTMLUListElement;
	if (!vaultList) return;

	// Clear existing vaults
	vaultList.textContent = '';
	generalSettings.vaults.forEach((vault, index) => {
		const li = document.createElement('li');
		li.dataset.index = index.toString();
		li.draggable = true;

		const dragHandle = createElementWithClass('div', 'drag-handle');
		dragHandle.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'grip-vertical' }));
		li.appendChild(dragHandle);

		const span = document.createElement('span');
		span.textContent = vault;
		li.appendChild(span);

		const removeBtn = createElementWithClass('button', 'setting-item-list-remove clickable-icon');
		removeBtn.setAttribute('type', 'button');
		removeBtn.setAttribute('aria-label', getMessage('removeVault'));
		removeBtn.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'trash-2' }));
		li.appendChild(removeBtn);

		li.addEventListener('dragstart', handleDragStart);
		li.addEventListener('dragover', handleDragOver);
		li.addEventListener('drop', handleDrop);
		li.addEventListener('dragend', handleDragEnd);
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			removeVault(index);
		});
		vaultList.appendChild(li);
	});

	initializeIcons(vaultList);
}

export function addVault(vault: string): void {
	generalSettings.vaults.push(vault);
	saveSettings();
	updateVaultList();
}

export function removeVault(index: number): void {
	generalSettings.vaults.splice(index, 1);
	saveSettings();
	updateVaultList();
}

export async function setShortcutInstructions() {
	const shortcutInstructionsElement = document.querySelector('.shortcut-instructions');
	if (shortcutInstructionsElement) {
		const browser = await detectBrowser();
		// Clear content
		shortcutInstructionsElement.textContent = '';
		shortcutInstructionsElement.appendChild(document.createTextNode(getMessage('shortcutInstructionsIntro') + ' '));
		
		// Browser-specific instructions
		let instructionsText = '';
		let url = '';
		
		switch (browser) {
			case 'chrome':
				instructionsText = getMessage('shortcutInstructionsChrome', ['$URL']);
				url = 'chrome://extensions/shortcuts';
				break;
			case 'brave':
				instructionsText = getMessage('shortcutInstructionsBrave', ['$URL']);
				url = 'brave://extensions/shortcuts';
				break;
			case 'firefox':
				instructionsText = getMessage('shortcutInstructionsFirefox', ['$URL']);
				url = 'about:addons';
				break;
			case 'edge':
				instructionsText = getMessage('shortcutInstructionsEdge', ['$URL']);
				url = 'edge://extensions/shortcuts';
				break;
			case 'safari':
			case 'mobile-safari':
				instructionsText = getMessage('shortcutInstructionsSafari');
				break;
			default:
				instructionsText = getMessage('shortcutInstructionsDefault');
		}
		
		if (url) {
			// Split text around the URL placeholder and add strong element
			const parts = instructionsText.split('$URL');
			if (parts.length === 2) {
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[0]));
				
				const strongElement = document.createElement('strong');
				strongElement.textContent = url;
				shortcutInstructionsElement.appendChild(strongElement);
				
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[1]));
			} else {
				// Fallback if no placeholder found
				shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
			}
		} else {
			// Safari and default cases (no URL needed)
			shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
		}
	}
}

async function initializeVersionDisplay(): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const versionNumber = document.getElementById('version-number');
	const updateAvailable = document.getElementById('update-available');
	const usingLatestVersion = document.getElementById('using-latest-version');

	if (versionNumber) {
		versionNumber.textContent = manifest.version;
	}

	// Only add update listener for browsers that support it
	const currentBrowser = await detectBrowser();
	if (currentBrowser !== 'safari' && currentBrowser !== 'mobile-safari' && browser.runtime.onUpdateAvailable) {
		browser.runtime.onUpdateAvailable.addListener((details) => {
			if (updateAvailable && usingLatestVersion) {
				updateAvailable.style.display = 'block';
				usingLatestVersion.style.display = 'none';
			}
		});
	} else {
		// For Safari, just hide the update status elements
		if (updateAvailable) {
			updateAvailable.style.display = 'none';
		}
		if (usingLatestVersion) {
			usingLatestVersion.style.display = 'none';
		}
	}
}

export function initializeGeneralSettings(): void {
	loadSettings().then(async () => {
		await setupLanguageAndDirection();

		// Add version check initialization
		await initializeVersionDisplay();

		updateVaultList();
		initializeShowMoreActionsToggle();
		initializeBetaFeaturesToggle();
		initializeLegacyModeToggle();
		initializeSilentOpenToggle();
		initializeVaultInput();
		initializeLocalVaultSettings();
		initializeOpenBehaviorDropdown();
		initializeDefaultTemplateDropdown();
		initializeKeyboardShortcuts();
		initializeToggles();
		setShortcutInstructions();
		void initializeAsrSettings();
		void initializeStudySitesSettings();
		void initializeStudyHome();
		initializeAutoSave();
		initializeResetDefaultTemplateButton();
		initializeExportImportAllSettingsButtons();
		initializeHighlighterSettings();
		initializeExportHighlightsButton();
		initializeSaveBehaviorDropdown();
		await initializeUsageChart();
	});
}

function initializeAutoSave(): void {
	// The settings are spread over several pages of the menu; each page's form saves the same way.
	for (const id of ['general-settings-form', 'clip-settings-form', 'learning-settings-form', 'video-settings-form']) {
		const form = document.getElementById(id);
		if (!form) continue;
		// Listen for both input and change events
		form.addEventListener('input', debounce(saveSettingsFromForm, 500));
		form.addEventListener('change', debounce(saveSettingsFromForm, 500));
	}
}

function saveSettingsFromForm(): void {
	const openBehaviorDropdown = document.getElementById('open-behavior-dropdown') as HTMLSelectElement;
	const showMoreActionsToggle = document.getElementById('show-more-actions-toggle') as HTMLInputElement;
	const betaFeaturesToggle = document.getElementById('beta-features-toggle') as HTMLInputElement;
	const legacyModeToggle = document.getElementById('legacy-mode-toggle') as HTMLInputElement;
	const silentOpenToggle = document.getElementById('silent-open-toggle') as HTMLInputElement;
	const highlighterToggle = document.getElementById('highlighter-toggle') as HTMLInputElement;
	const alwaysShowHighlightsToggle = document.getElementById('highlighter-visibility') as HTMLInputElement;
	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;

	const updatedSettings = {
		...generalSettings, // Keep existing settings
		openBehavior: (openBehaviorDropdown?.value as Settings['openBehavior']) ?? generalSettings.openBehavior,
		showMoreActionsButton: showMoreActionsToggle?.checked ?? generalSettings.showMoreActionsButton,
		betaFeatures: betaFeaturesToggle?.checked ?? generalSettings.betaFeatures,
		legacyMode: legacyModeToggle?.checked ?? generalSettings.legacyMode,
		silentOpen: silentOpenToggle?.checked ?? generalSettings.silentOpen,
		highlighterEnabled: highlighterToggle?.checked ?? generalSettings.highlighterEnabled,
		alwaysShowHighlights: alwaysShowHighlightsToggle?.checked ?? generalSettings.alwaysShowHighlights,
		highlightBehavior: highlightBehaviorSelect?.value ?? generalSettings.highlightBehavior
	};

	saveSettings(updatedSettings);
}

function initializeShowMoreActionsToggle(): void {
	initializeSettingToggle('show-more-actions-toggle', generalSettings.showMoreActionsButton, (checked) => {
		saveSettings({ ...generalSettings, showMoreActionsButton: checked });
	});
}

async function initializeLocalVaultSettings(): Promise<void> {
	const input = document.getElementById('local-vault-path') as HTMLInputElement | null;
	const button = document.getElementById('local-vault-save') as HTMLButtonElement | null;
	const choose = document.getElementById('local-vault-choose') as HTMLButtonElement | null;
	const status = document.getElementById('local-vault-status');
	if (!input || !button || !status) return;
	let edited = false;
	let failure: string | undefined;
	const help = document.getElementById('local-helper-help');
	const copy = document.getElementById('local-helper-copy') as HTMLButtonElement | null;
	const offline = (message: string, reason?: string) => { failure = reason; status.textContent = message; if (help) help.hidden = false; };
	copy?.addEventListener('click', async () => {
		try { await navigator.clipboard.writeText(nativeHelperRepairPrompt(browser.runtime.id, failure)); copy.textContent = '已复制，去发给 AI 助手（Codex、Claude Code 等）'; }
		catch { copy.textContent = '复制失败，请点“查看安装说明”'; }
	});
	input.addEventListener('input', () => { edited = true; });
	choose?.addEventListener('click', async () => {
		choose.disabled = true;
		button.disabled = true;
		edited = true;
		try {
			const result = await browser.runtime.sendMessage({ action: 'qiaomuLocalChooseVault' }) as LocalSaveResult;
			if (result?.cancelled) return;
			if (!result?.ok || !result.vaultPath) { if ((result as { reason?: string })?.reason) offline(result.error || '文件夹选择失败', (result as { reason?: string }).reason); else status.textContent = result?.error || '文件夹选择失败'; return; }
			input.value = result.vaultPath;
			status.textContent = `已选择 ${result.vault}，点「保存」生效。`;
		} catch { offline('本地保存助手未连接，请先安装或更新助手'); }
		finally { choose.disabled = false; button.disabled = false; }
	});
	const configure = async () => {
		if (button.disabled) return;
		button.disabled = true;
		if (choose) choose.disabled = true;
		edited = true;
		status.textContent = '正在验证笔记库地址…';
		try {
			const result = await browser.runtime.sendMessage({ action: 'qiaomuLocalConfigure', payload: { vaultPath: input.value.trim() } }) as LocalSaveResult;
			if (!result?.ok || !result.vault || !result.vaultPath) {
				if ((result as { reason?: string })?.reason) offline(result.error || '库地址保存失败', (result as { reason?: string }).reason); else status.textContent = result?.error || '库地址保存失败，请检查本地保存助手';
				return;
			}
			if (!generalSettings.vaults.includes(result.vault)) {
				generalSettings.vaults.push(result.vault);
				await saveSettings();
				updateVaultList();
			}
			await browser.storage.local.set({ qiaomuNativeConfigured: true });
			await setLocalStorage('lastSelectedVault', result.vault);
			input.value = result.vaultPath;
			status.textContent = `已保存：${result.vaultPath}。重新打开剪藏弹窗即可使用，失败的笔记可点击“重试本地保存”。`;
		} catch {
			offline('本地保存助手未连接，请先安装或更新助手');
		} finally { button.disabled = false; if (choose) choose.disabled = false; }
	};
	button.addEventListener('click', configure);
	input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); configure(); } });
	try {
		const result = await browser.runtime.sendMessage({ action: 'qiaomuLocalStatus' }) as LocalSaveResult;
		if (edited) return;
		if (result?.ok && result.vaultPath) { input.value = result.vaultPath; status.textContent = `当前保存到：${result.vaultPath}`; }
		else { offline(`${describeHelperFailure(result?.reason)}安装后可在这里切换笔记库地址。`, result?.reason); }
	} catch { if (!edited) offline('本地保存助手未连接。安装助手后可在这里切换笔记库地址。'); }
}

function initializeVaultInput(): void {
	const vaultInput = document.getElementById('vault-input') as HTMLInputElement;
	if (vaultInput) {
		vaultInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const newVault = vaultInput.value.trim();
				if (newVault) {
					addVault(newVault);
					vaultInput.value = '';
				}
			}
		});
	}
}

async function initializeKeyboardShortcuts(): Promise<void> {
	const shortcutsList = document.getElementById('keyboard-shortcuts-list');
	if (!shortcutsList) return;

	const browser = await detectBrowser();

	if (browser === 'mobile-safari') {
		// For Safari, display a message about keyboard shortcuts not being available
		const messageItem = document.createElement('div');
		messageItem.className = 'shortcut-item';
		messageItem.textContent = getMessage('shortcutInstructionsSafari');
		shortcutsList.appendChild(messageItem);
	} else {
		// For other browsers, proceed with displaying the shortcuts
		getCommands().then(commands => {
			commands.forEach(command => {
				const shortcutItem = createElementWithClass('div', 'shortcut-item');
				
				const descriptionSpan = document.createElement('span');
				descriptionSpan.textContent = command.description;
				shortcutItem.appendChild(descriptionSpan);

				const hotkeySpan = createElementWithClass('span', 'setting-hotkey');
				hotkeySpan.textContent = command.shortcut || getMessage('shortcutNotSet');
				shortcutItem.appendChild(hotkeySpan);

				shortcutsList.appendChild(shortcutItem);
			});
		});
	}
}

function initializeBetaFeaturesToggle(): void {
	initializeSettingToggle('beta-features-toggle', generalSettings.betaFeatures, (checked) => {
		saveSettings({ ...generalSettings, betaFeatures: checked });
	});
}

function initializeLegacyModeToggle(): void {
	initializeSettingToggle('legacy-mode-toggle', generalSettings.legacyMode, (checked) => {
		saveSettings({ ...generalSettings, legacyMode: checked });
	});
}

function initializeSilentOpenToggle(): void {
	initializeSettingToggle('silent-open-toggle', generalSettings.silentOpen, (checked) => {
		saveSettings({ ...generalSettings, silentOpen: checked });
	});
}

function initializeOpenBehaviorDropdown(): void {
	initializeSettingDropdown(
		'open-behavior-dropdown',
		generalSettings.openBehavior,
		(value) => {
			saveSettings({ ...generalSettings, openBehavior: value as Settings['openBehavior'] });
		}
	);
}

function populateDefaultTemplateDropdown(templates: Template[]): void {
	const dropdown = document.getElementById('default-template-dropdown') as HTMLSelectElement | null;
	if (!dropdown) return;
	dropdown.textContent = '';
	templates.forEach(template => {
		const option = document.createElement('option');
		option.value = template.id;
		option.textContent = template.name;
		dropdown.appendChild(option);
	});
	dropdown.value = templates.some(t => t.id === generalSettings.defaultTemplateId) ? generalSettings.defaultTemplateId! : (templates[0]?.id ?? '');
}

// Templates load after the general settings are built, so the list follows every template list update.
// Per-action shortcut letters: one character each, no duplicates; an empty box switches the action off.
function initializeTripleKeyFields(): void {
	const inputs = Object.fromEntries(TRIPLE_COMMANDS.map(command => [command, document.getElementById(`triple-key-${command}`) as HTMLInputElement | null])) as Record<TripleCommand, HTMLInputElement | null>;
	const error = document.getElementById('triple-key-error');
	if (!inputs.read || !inputs.edit || !inputs.clip || !inputs.note) return;

	const fill = (keys: Record<TripleCommand, string>) => TRIPLE_COMMANDS.forEach(command => { inputs[command]!.value = keys[command]; });
	fill(normalizeTripleKeys(generalSettings.tripleKeys));

	const showError = (message: string) => { if (error) { error.hidden = !message; error.textContent = message; } };
	const save = () => {
		const typed = Object.fromEntries(TRIPLE_COMMANDS.map(command => [command, inputs[command]!.value.trim().toLowerCase()])) as Record<TripleCommand, string>;
		const invalid = TRIPLE_COMMANDS.find(command => typed[command] && !/^[a-z0-9]$/.test(typed[command]));
		const filled = TRIPLE_COMMANDS.filter(command => typed[command]);
		const duplicate = filled.some((command, index) => filled.findIndex(other => typed[other] === typed[command]) !== index);
		if (invalid) return showError(getMessage('tripleKeyInvalid'));
		if (duplicate) return showError(getMessage('tripleKeyDuplicate'));
		showError('');
		saveSettings({ ...generalSettings, tripleKeys: typed });
	};
	TRIPLE_COMMANDS.forEach(command => {
		inputs[command]!.addEventListener('input', () => { inputs[command]!.value = inputs[command]!.value.toLowerCase(); save(); });
		inputs[command]!.addEventListener('focus', () => inputs[command]!.select());
	});
	document.getElementById('triple-key-reset')?.addEventListener('click', () => {
		fill(DEFAULT_TRIPLE_KEYS);
		showError('');
		saveSettings({ ...generalSettings, tripleKeys: { ...DEFAULT_TRIPLE_KEYS } });
	});
}

function initializeDefaultTemplateDropdown(): void {
	const dropdown = document.getElementById('default-template-dropdown') as HTMLSelectElement | null;
	if (dropdown) {
		populateDefaultTemplateDropdown(getTemplates());
		document.addEventListener('qiaomu-templates-updated', event => populateDefaultTemplateDropdown((event as CustomEvent<Template[]>).detail));
		dropdown.addEventListener('change', () => saveSettings({ ...generalSettings, defaultTemplateId: dropdown.value }));
	}
	initializeSettingToggle('youtube-hide-native-toggle', generalSettings.youtubeHideNativeTranscript !== false, (checked) => {
		saveSettings({ ...generalSettings, youtubeHideNativeTranscript: checked });
	});
	initializeSettingToggle('youtube-auto-transcript-toggle', generalSettings.youtubeAutoTranscript !== false, (checked) => {
		saveSettings({ ...generalSettings, youtubeAutoTranscript: checked });
	});
	void browser.storage.local.get('qiaomuRssEnabled').then(saved => {
		initializeSettingToggle('rss-share-toggle', saved.qiaomuRssEnabled === true, (checked) => { void browser.storage.local.set({ qiaomuRssEnabled: checked }); });
	});
	initializeSettingToggle('learning-notes-toggle', generalSettings.learningNotes !== false, (checked) => {
		saveSettings({ ...generalSettings, learningNotes: checked });
	});
	initializeSettingToggle('learning-include-quote-toggle', generalSettings.learningIncludeQuote !== false, (checked) => {
		saveSettings({ ...generalSettings, learningIncludeQuote: checked });
	});
	initializeSettingToggle('learning-include-source-toggle', generalSettings.learningIncludeSource !== false, (checked) => {
		saveSettings({ ...generalSettings, learningIncludeSource: checked });
	});
	initializeSettingToggle('youtube-panel-actions-toggle', generalSettings.youtubePanelActions !== false, (checked) => {
		saveSettings({ ...generalSettings, youtubePanelActions: checked });
	});
	initializeSettingToggle('selection-toolbar-toggle', generalSettings.selectionToolbar !== false, (checked) => {
		saveSettings({ ...generalSettings, selectionToolbar: checked });
	});
	initializeSettingToggle('reader-auto-chat-toggle', generalSettings.readerAutoChat === true, (checked) => {
		saveSettings({ ...generalSettings, readerAutoChat: checked });
	});
	initializeTripleKeyFields();
	const sites = document.getElementById('triple-key-sites') as HTMLTextAreaElement | null;
	if (sites) {
		sites.value = normalizeSites(generalSettings.tripleKeyBlockedSites).join('\n');
		sites.addEventListener('input', debounce(() => {
			saveSettings({ ...generalSettings, tripleKeyBlockedSites: normalizeSites(sites.value.split(/[\n,;\s]+/)) });
		}, 400));
		sites.addEventListener('blur', () => { sites.value = normalizeSites(generalSettings.tripleKeyBlockedSites).join('\n'); });
	}
	initializeSettingToggle('triple-key-toggle', generalSettings.tripleKeyShortcuts !== false, (checked) => {
		saveSettings({ ...generalSettings, tripleKeyShortcuts: checked });
	});
}

function initializeResetDefaultTemplateButton(): void {
	const resetDefaultTemplateBtn = document.getElementById('reset-default-template-btn');
	if (resetDefaultTemplateBtn) {
		resetDefaultTemplateBtn.addEventListener('click', resetDefaultTemplate);
	}
}

function initializeSaveBehaviorDropdown(): void {
    const dropdown = document.getElementById('save-behavior-dropdown') as HTMLSelectElement;
    if (!dropdown) return;

    dropdown.value = generalSettings.saveBehavior;
    dropdown.addEventListener('change', () => {
        const newValue = dropdown.value as 'addToObsidian' | 'copyToClipboard' | 'saveFile';
        saveSettings({ saveBehavior: newValue });
    });
}

export function resetDefaultTemplate(): void {
	const defaultTemplate = createDefaultTemplate();
	const currentTemplates = getTemplates();
	const defaultIndex = currentTemplates.findIndex((t: Template) => t.name === getMessage('defaultTemplateName'));
	
	if (defaultIndex !== -1) {
		currentTemplates[defaultIndex] = defaultTemplate;
	} else {
		currentTemplates.unshift(defaultTemplate);
	}

	saveTemplateSettings().then(() => {
		updateTemplateList();
		showTemplateEditor(defaultTemplate);
	}).catch(error => {
		console.error('Failed to reset default template:', error);
		alert(getMessage('failedToResetTemplate'));
	});
}

function initializeExportImportAllSettingsButtons(): void {
	const exportAllSettingsBtn = document.getElementById('export-all-settings-btn');
	if (exportAllSettingsBtn) {
		exportAllSettingsBtn.addEventListener('click', exportAllSettings);
	}

	const importAllSettingsBtn = document.getElementById('import-all-settings-btn');
	if (importAllSettingsBtn) {
		importAllSettingsBtn.addEventListener('click', importAllSettings);
	}
}

function initializeExportHighlightsButton(): void {
	const exportHighlightsBtn = document.getElementById('export-highlights');
	if (exportHighlightsBtn) {
		exportHighlightsBtn.addEventListener('click', exportHighlights);
	}

	const importHighlightsBtn = document.getElementById('import-highlights');
	if (importHighlightsBtn) {
		importHighlightsBtn.addEventListener('click', importHighlights);
	}
}

function initializeHighlighterSettings(): void {
	initializeSettingToggle('highlighter-toggle', generalSettings.highlighterEnabled, (checked) => {
		saveSettings({ ...generalSettings, highlighterEnabled: checked });
	});

	initializeSettingToggle('highlighter-visibility', generalSettings.alwaysShowHighlights, (checked) => {
		saveSettings({ ...generalSettings, alwaysShowHighlights: checked });
	});

	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;
	if (highlightBehaviorSelect) {
		highlightBehaviorSelect.value = generalSettings.highlightBehavior;
		highlightBehaviorSelect.addEventListener('change', () => {
			saveSettings({ ...generalSettings, highlightBehavior: highlightBehaviorSelect.value });
		});
	}
}

async function initializeUsageChart(): Promise<void> {
	const chartContainer = document.getElementById('usage-chart');
	const metricSelect = document.getElementById('usage-metric-select') as HTMLSelectElement;
	const periodSelect = document.getElementById('usage-period-select') as HTMLSelectElement;
	const aggregationSelect = document.getElementById('usage-aggregation-select') as HTMLSelectElement;
	if (!chartContainer || !metricSelect || !periodSelect || !aggregationSelect) return;

	const history = await getClipHistory();

	const updateChart = async () => {
		const options = {
			timeRange: periodSelect.value as '30d' | 'all',
			aggregation: aggregationSelect.value as 'day' | 'week' | 'month'
		};

		const chartData = aggregateUsageData(history, options);
		await createUsageChart(chartContainer, chartData, metricSelect.value as UsageMetric);
	};

	// Initialize with default selections
	await updateChart();

	// Update when any selector changes
	metricSelect.addEventListener('change', updateChart);
	periodSelect.addEventListener('change', updateChart);
	aggregationSelect.addEventListener('change', updateChart);
}

function initializeSettingDropdown(
	elementId: string,
	defaultValue: string,
	onChange: (newValue: string) => void
): void {
	const dropdown = document.getElementById(elementId) as HTMLSelectElement;
	if (!dropdown) return;
	dropdown.value = defaultValue;
	dropdown.addEventListener('change', () => {
		onChange(dropdown.value);
	});
}
