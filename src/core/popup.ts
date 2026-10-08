import { openClipPreview } from '../utils/clip-preview';
import { saveLocalClip, LocalSavePayload } from '../utils/local-save';
import { QiaomuClip, QiaomuResult } from '../utils/qiaomu-rss';
import dayjs from 'dayjs';
import { Template, Property, PromptVariable } from '../types/types';
import { incrementStat, addHistoryEntry, getClipHistory } from '../utils/storage-utils';
import { generateFrontmatter, saveToObsidian } from '../utils/obsidian-note-creator';
import { extractPageContent, initializePageContent } from '../utils/content-extractor';
import { compileTemplate } from '../utils/template-compiler';
import { initializeIcons, getPropertyTypeIcon } from '../icons/icons';
import { findMatchingTemplate, initializeTriggers } from '../utils/triggers';
import { getLocalStorage, setLocalStorage, loadSettings, generalSettings, saveSettings, Settings } from '../utils/storage-utils';
import { normalizeSites, isSiteBlocked } from '../utils/triple-key';
import { escapeHtml, unescapeValue } from '../utils/string-utils';
import { loadTemplates, createDefaultTemplate } from '../managers/template-manager';
import browser from '../utils/browser-polyfill';
import { addBrowserClassToHtml, detectBrowser } from '../utils/browser-detection';
import { createElementWithClass } from '../utils/dom-utils';
import { initializeInterpreter, handleInterpreterUI, collectPromptVariables } from '../utils/interpreter';
import { adjustNoteNameHeight } from '../utils/ui-utils';
import { debugLog, isDebugMode } from '../utils/debug';
import { showVariables, initializeVariablesPanel, updateVariablesPanel } from '../managers/inspect-variables';
import { isBlankPage, isValidUrl, isRestrictedUrl } from '../utils/active-tab-manager';
import { memoizeWithExpiration } from '../utils/memoize';
import { debounce } from '../utils/debounce';
import { sanitizeFileName } from '../utils/string-utils';
import { saveFile } from '../utils/file-utils';
import { translatePage, getMessage, setupLanguageAndDirection } from '../utils/i18n';
import { formatPropertyValue } from '../utils/shared';
import { describeHelperFailure, nativeHelperRepairPrompt } from '../utils/native-helper-prompt';

import { t } from '../utils/ui-text';
interface ReaderModeResponse {
	success: boolean;
	isActive: boolean;
}

let pendingQiaomuClip: QiaomuClip | null = null;
let clipInProgress = false;
let nativeLocalSave = false;
let pendingLocalSave: LocalSavePayload | null = null;
let loadedSettings: Settings;
let currentTemplate: Template | null = null;
let templates: Template[] = [];
let currentVariables: { [key: string]: string } = {};
let currentTabId: number | undefined;
let lastSelectedVault: string | null = null;

const isSidePanel = window.location.pathname.includes('side-panel.html');
const urlParams = new URLSearchParams(window.location.search);
const isIframe = urlParams.get('context') === 'iframe';

// Memoize compileTemplate with a short expiration and URL-sensitive key
const memoizedCompileTemplate = memoizeWithExpiration(
	async (tabId: number, template: string, variables: { [key: string]: string }, currentUrl: string) => {
		return compileTemplate(tabId, template, variables, currentUrl);
	},
	{
		expirationMs: 5000,
		keyFn: (tabId: number, template: string, variables: { [key: string]: string }, currentUrl: string) =>
			`${tabId}-${template}-${currentUrl}`
	}
);

// Memoize generateFrontmatter with a longer expiration
const memoizedGenerateFrontmatter = memoizeWithExpiration(
	async (properties: Property[]) => {
		return generateFrontmatter(properties);
	},
	{ expirationMs: 5000 }
);

function getPropertiesFromDOM(): Property[] {
	return Array.from(document.querySelectorAll('.metadata-property input')).map(input => {
		const inputElement = input as HTMLInputElement;
		return {
			id: inputElement.dataset.id || Date.now().toString() + Math.random().toString(36).slice(2, 11),
			name: inputElement.id,
			value: inputElement.type === 'checkbox' ? inputElement.checked : inputElement.value
		};
	}) as Property[];
}

// Helper function to get tab info from background script
async function getTabInfo(tabId: number): Promise<{ id: number; url: string }> {
	const response = await browser.runtime.sendMessage({ action: "getTabInfo", tabId }) as { success?: boolean; tab?: { id: number; url: string }; error?: string };
	if (!response || !response.success || !response.tab) {
		throw new Error((response && response.error) || 'Failed to get tab info');
	}
	// On the reader page, tabs.get() can't see the extension page URL
	// without the tabs permission. Fall back to the readerUrl param
	// passed through the iframe src.
	if (!response.tab.url) {
		const readerUrl = urlParams.get('readerUrl');
		if (readerUrl) {
			response.tab.url = readerUrl;
		}
	}
	return response.tab;
}

// Helper function to get current tab URL and title for stats
async function getCurrentTabInfo(): Promise<{ url: string; title?: string; image?: string }> {
	if (!currentTabId) {
		return { url: '' };
	}

	try {
		const tab = await getTabInfo(currentTabId);
		// Try to get the title from the extracted content if available
		const extractedData = await memoizedExtractPageContent(currentTabId);
		return {
			url: tab.url,
			title: extractedData?.title || document.title,
			image: extractedData?.image || undefined
		};
	} catch (error) {
		console.warn('Failed to get current tab info for stats:', error);
		return { url: '' };
	}
}

// Memoize extractPageContent with URL-sensitive key
const memoizedExtractPageContent = memoizeWithExpiration(
	async (tabId: number) => {
		await getTabInfo(tabId);
		return extractPageContent(tabId);
	},
	{
		expirationMs: 5000,
		keyFn: async (tabId: number) => {
			const tab = await getTabInfo(tabId);
			return `${tabId}-${tab.url}`;
		}
	}
);

// Width is used to update the note name field height
let previousWidth = window.innerWidth;

function setPopupDimensions() {
	// Get the actual height of the popup after the browser has determined its maximum
	const actualHeight = document.documentElement.offsetHeight;

	// Calculate the viewport height and width
	const viewportHeight = window.innerHeight;
	const viewportWidth = window.innerWidth;

	// Use the smaller of the two heights
	const finalHeight = Math.min(actualHeight, viewportHeight);

	// Set the --popup-height CSS variable to the final height
	document.documentElement.style.setProperty('--chromium-popup-height', `${finalHeight}px`);

	// Check if the width has changed
	if (viewportWidth !== previousWidth) {
		previousWidth = viewportWidth;

		// Adjust the note name field height
		const noteNameField = document.getElementById('note-name-field') as HTMLTextAreaElement;
		if (noteNameField) {
			adjustNoteNameHeight(noteNameField);
		}
	}
}

const debouncedSetPopupDimensions = debounce(setPopupDimensions, 100); // 100ms delay

async function initializeExtension(tabId: number) {
	try {
		// Initialize translations
		await translatePage();

		// Setup language and RTL support
		await setupLanguageAndDirection();

		// First, add the browser class to allow browser-specific styles to apply
		await addBrowserClassToHtml();

		// Set an initial large height to allow the browser to determine the maximum height
		// This is necessary for browsers that allow scaling the popup via page zoom
		document.documentElement.style.setProperty('--chromium-popup-height', '2000px');

		// Use setTimeout to ensure the DOM has updated before we measure
		setTimeout(() => {
			setPopupDimensions();
		}, 0);

		debugLog('Settings', 'General settings:', loadedSettings);

		templates = await loadTemplates();
		debugLog('Templates', 'Loaded templates:', templates);

		if (templates.length === 0) {
			console.error('No templates loaded');
			return false;
		}

		// Initialize triggers to speed up template matching
		initializeTriggers(templates);

		currentTemplate = templates.find(t => t.id === loadedSettings.defaultTemplateId) || templates[0];
		debugLog('Templates', 'Current template set to:', currentTemplate);

		// Load last selected vault
		lastSelectedVault = await getLocalStorage('lastSelectedVault');
		if (!lastSelectedVault && loadedSettings.vaults.length > 0) {
			lastSelectedVault = loadedSettings.vaults[0];
		}
		debugLog('Vaults', 'Last selected vault:', lastSelectedVault);

		const tab = await getTabInfo(tabId);
		if (!tab.url || isBlankPage(tab.url)) {
			showError('pageCannotBeClipped');
			return;
		}
		if (!isValidUrl(tab.url)) {
			showError('onlyHttpSupported');
			return;
		}
		if (isRestrictedUrl(tab.url)) {
			showError('pageCannotBeClipped');
			return;
		}

		// Setup message listeners
		setupMessageListeners();
		setupStorageListeners();

		await checkHighlighterModeState(tabId);

		return true;
	} catch (error) {
		console.error('Error initializing extension:', error);
		showError('failedToInitialize');
		return false;
	}
}

const debouncedHighlightRefresh = debounce(() => {
	if (currentTabId !== undefined) {
		memoizedExtractPageContent.clear();
		memoizedCompileTemplate.clear();
		refreshFields(currentTabId, { checkTemplateTriggers: false, rebuildSkeleton: false });
	}
}, 300);

function setupStorageListeners() {
	browser.storage.local.onChanged.addListener((changes) => {
		if (changes.highlights) {
			debouncedHighlightRefresh();
		}
	});
}

function setupMessageListeners() {
	browser.runtime.onMessage.addListener((request: any, sender: browser.Runtime.MessageSender, sendResponse: (response?: any) => void) => {
		if (request.action === "triggerQuickClip") {
			handleClipObsidian().then(() => {
				sendResponse({success: true});
			}).catch((error) => {
				console.error('Error in handleClipObsidian:', error);
				sendResponse({success: false, error: error.message});
			});
			return true;
		} else if (request.action === "tabUrlChanged") {
			if (request.tabId === currentTabId) {
				if (currentTabId !== undefined) {
					refreshFields(currentTabId);
				}
			}
		} else if (request.action === "activeTabChanged") {
			// Only handle active tab changes if we're in side panel mode, not iframe mode
			if (!isIframe) {
				currentTabId = request.tabId;
				if (request.isRestrictedUrl) {
					showError('pageCannotBeClipped');
				} else if (request.isValidUrl) {
					if (currentTabId !== undefined) {
						refreshFields(currentTabId); // Force template check when URL changes
					}
				} else if (request.isBlankPage) {
					showError('pageCannotBeClipped');
				} else {
					showError('onlyHttpSupported');
				}
			}
		} else if (request.action === "updatePopupHighlighterUI") {
			// This message is now handled by checkHighlighterModeState
		} else if (request.action === "highlighterModeChanged") {
			// This message is now handled by checkHighlighterModeState
		}
	});
}

document.addEventListener('DOMContentLoaded', async function() {
	loadedSettings = await loadSettings();
	await initializeQiaomuRss();
	if (isIframe) {
		document.documentElement.classList.add('is-embedded');
	}

	const isSidePanel = document.documentElement.classList.contains('is-side-panel');

	try {
		// Get the active tab via background script to handle Firefox compatibility
		const response = await browser.runtime.sendMessage({ action: "getActiveTab" }) as { tabId?: number; error?: string };
		if (!response || response.error || !response.tabId) {
			showError(getMessage('pleaseReload'));
			return;
		}

		currentTabId = response.tabId;
		const tab = await getTabInfo(currentTabId);
		const currentBrowser = await detectBrowser();
		const isMobile = currentBrowser === 'mobile-safari';

		const openBehavior: Settings['openBehavior'] = isMobile && loadedSettings.openBehavior !== 'reader' ? 'popup' : loadedSettings.openBehavior;

		// Check if we should open in an iframe, but only if the URL is valid
		if (isValidUrl(tab.url) && !isBlankPage(tab.url) && openBehavior === 'embedded' && !isIframe && !isSidePanel) {
			try {
				const response = await browser.runtime.sendMessage({ action: "getActiveTabAndToggleIframe" }) as { success?: boolean; error?: string };
				if (response && response.success) {
					window.close();
					return; // Exit script after closing the window
				} else if (response && response.error) {
					console.error('Error toggling iframe:', response.error);
					// If there's an error, we'll fall through and open the normal popup.
				}
			} catch (error) {
				console.error('Error toggling iframe:', error);
				// If there's an error, we'll fall through and open the normal popup.
			}
		}

		// Check if we should open in reader mode
		if (isValidUrl(tab.url) && !isBlankPage(tab.url) && openBehavior === 'reader' && !isIframe && !isSidePanel) {
			try {
				const response = await browser.runtime.sendMessage({
					action: "toggleReaderMode",
					tabId: currentTabId
				}) as ReaderModeResponse;
				if (response && response.success) {
					window.close();
					return;
				}
			} catch (error) {
				console.error('Error toggling reader mode:', error);
				// If there's an error, we'll fall through and open the normal popup.
			}
		}

		// Connect to the background script for communication
		browser.runtime.connect({ name: 'popup' });

		// Setup event listeners for popup buttons
		const refreshButton = document.getElementById('refresh-pane');
		if (refreshButton) {
			if (isIframe) {
				refreshButton.style.display = 'none';
			} else {
				refreshButton.addEventListener('click', (e) => {
					e.preventDefault();
					refreshPopup();
					initializeIcons(refreshButton);
				});
			}
		}
		const settingsButton = document.getElementById('open-settings');
		if (settingsButton) {
			settingsButton.addEventListener('click', async function() {
				try {
					await browser.runtime.sendMessage({ action: "openOptionsPage" });
					setTimeout(() => window.close(), 50);
				} catch (error) {
					console.error('Error opening options page:', error);
				}
			});
			initializeIcons(settingsButton);
		}

		// Initialize the rest of the popup
		if (currentTabId) {
			const initialized = await initializeExtension(currentTabId);
			if (!initialized) {
				return;
			}

			try {
				// DOM-dependent initializations
				updateVaultDropdown(loadedSettings.vaults);
				populateTemplateDropdown();
				setupEventListeners(currentTabId);
				await initializeUI();

				determineMainAction();


				// Initial content load
				await refreshFields(currentTabId);
				await consumePendingAction();
			} catch (error) {
				console.error('Error initializing popup:', error);
				showError(getMessage('pleaseReload'));
			}
		} else {
			showError(getMessage('pleaseReload'));
		}
	} catch (error) {
		console.error('Error getting active tab:', error);
		showError(getMessage('pleaseReload'));
	}
});

// Triple-press shortcuts (read / edit / clip) open the popup and leave the action here; run it once the clip is ready.
async function consumePendingAction() {
	const data = await browser.storage.local.get('qiaomuPendingAction');
	const pending = data.qiaomuPendingAction as { action: 'read' | 'edit' | 'clip'; at: number; hidden?: boolean } | undefined;
	if (!pending) return;
	await browser.storage.local.remove('qiaomuPendingAction');
	if (Date.now() - pending.at > 15000) return;
	if (pending.action === 'edit' || pending.action === 'read') {
		document.getElementById(pending.action === 'edit' ? 'open-editor' : 'preview-clip')?.click();
		// Run from the page's invisible copy: once our page is open there is nothing left for it to do.
		if (pending.hidden) setTimeout(() => { void browser.runtime.sendMessage({ action: 'closeIframe' }).catch(() => {}); }, 4000);
		return;
	}
	// Never save raw {{"prompt"}} text when the AI step failed.
	if (document.getElementById('interpreter')?.classList.contains('error')) {
		const status = document.getElementById('clip-action-status');
		if (status) status.textContent = getMessage('qiaomuAiFailed');
		return;
	}
	await handleClipObsidian();
}

function setupEventListeners(tabId: number) {
	const templateDropdown = document.getElementById('template-select') as HTMLSelectElement;
	if (templateDropdown) {
		templateDropdown.addEventListener('change', function(this: HTMLSelectElement) {
			handleTemplateChange(this.value);
		});
	}

	const noteNameField = document.getElementById('note-name-field') as HTMLTextAreaElement;
	if (noteNameField) {
		noteNameField.addEventListener('input', () => adjustNoteNameHeight(noteNameField));
		noteNameField.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
			}
		});
	}

	const highlighterModeButton = document.getElementById('highlighter-mode');
	if (highlighterModeButton) {
		highlighterModeButton.addEventListener('click', () => toggleHighlighterMode(tabId));
	}

	const embeddedModeButton = document.getElementById('embedded-mode');
		if (embeddedModeButton) {
			embeddedModeButton.addEventListener('click', async function() {
				try {
					await browser.runtime.sendMessage({ action: "getActiveTabAndToggleIframe" });
					setTimeout(() => window.close(), 50);
				} catch (error) {
					console.error('Error toggling emedded iframe:', error);
				}
			});
		}

	const copyContentButton = document.getElementById('copy-content');
	const saveDownloadsButton = document.getElementById('save-downloads');

	if (copyContentButton) {
		copyContentButton.addEventListener('click', async () => {
			const properties = getPropertiesFromDOM();

			const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
			const frontmatter = await generateFrontmatter(properties);
			const fileContent = frontmatter + noteContentField.value;

			await copyToClipboard(fileContent);
		});
	}

	if (saveDownloadsButton) {
		saveDownloadsButton.addEventListener('click', handleSaveToDownloads);
	}

	const shareButtons = document.querySelectorAll('.share-content');
	if (shareButtons) {
		shareButtons.forEach(button => {
			button.addEventListener('click', async (e) => {
				// Get content synchronously
				const properties = getPropertiesFromDOM();

				const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;

				// Use Promise.all to prepare the data
				Promise.all([
					generateFrontmatter(properties),
					Promise.resolve(noteContentField.value)
				]).then(([frontmatter, noteContent]) => {
					const fileContent = frontmatter + noteContent;

					// Call share directly from the click handler
					const noteNameField = document.getElementById('note-name-field') as HTMLInputElement;
					let fileName = noteNameField?.value || 'untitled';
					fileName = sanitizeFileName(fileName);
					if (!fileName.toLowerCase().endsWith('.md')) {
						fileName += '.md';
					}

					if (navigator.share && navigator.canShare) {
						const blob = new Blob([fileContent], { type: 'text/markdown;charset=utf-8' });
						const file = new File([blob], fileName, { type: 'text/markdown;charset=utf-8' });

						const shareData = {
							files: [file],
							text: 'Shared from Obsidian Web Clipper'
						};

						if (navigator.canShare(shareData)) {
							const pathField = document.getElementById('path-name-field') as HTMLInputElement;
							const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement;
							const path = pathField?.value || '';
							const vault = vaultDropdown?.value || '';

							navigator.share(shareData)
								.then(async () => {
									const tabInfo = await getCurrentTabInfo();
									await incrementStat('share', vault, path, tabInfo.url, tabInfo.title);
									const moreDropdown = document.getElementById('more-dropdown');
									if (moreDropdown) {
											moreDropdown.classList.remove('show');
									}
								})
								.catch((error) => {
									console.error('Error sharing:', error);
								});
						}
					}
				});
			});
		});
	}

	const shareButtonElements = document.querySelectorAll('.share-content');
	if (shareButtonElements.length > 0) {
		detectBrowser().then(browser => {
			const isSafariBrowser = ['safari', 'mobile-safari', 'ipad-os'].includes(browser);
			if (!isSafariBrowser || !navigator.share || !navigator.canShare) {
				shareButtonElements.forEach(button => {
					const parentElement = button.closest('.share-btn, .menu-item') as HTMLElement;
					if (parentElement) {
						parentElement.style.display = 'none';
					}
				});
			} else {
				// Test if we can share files (only on Safari)
				try {
					const testFile = new File(["test"], "test.txt", { type: "text/plain" });
					const testShare = { files: [testFile] };
					if (!navigator.canShare(testShare)) {
						throw new Error('canShare returned false');
					}
				} catch {
					shareButtonElements.forEach(button => {
						const parentElement = button.closest('.share-btn, .menu-item') as HTMLElement;
						if (parentElement) {
							parentElement.style.display = 'none';
						}
					});
				}
			}
		});
	}

	const readerModeButton = document.getElementById('reader-mode');
	if (readerModeButton) {
		// Our reading page, the same as the Read button: not the in-page reader.
		readerModeButton.addEventListener('click', event => { event.preventDefault(); document.getElementById('preview-clip')?.click(); });
	}
}

async function initializeUI() {
	setupCompactPopup();
	// Paste a video or podcast link, or choose a file, to transcribe and study.
	document.getElementById('open-study-home')?.addEventListener('click', event => { event.preventDefault(); void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=study') }).then(() => window.close()); });
	const clipButton = document.getElementById('clip-btn');
	if (clipButton) {
		clipButton.focus();
	} else {
		console.warn('Clip button not found');
	}

	const showMoreActionsButton = document.getElementById('show-variables') as HTMLElement;
	const variablesPanel = document.createElement('div');
	variablesPanel.className = 'variables-panel';
	document.body.appendChild(variablesPanel);

	if (showMoreActionsButton) {
		showMoreActionsButton.addEventListener('click', async (e) => {
			e.preventDefault();
			// Initialize the variables panel with the latest data
			initializeVariablesPanel(variablesPanel, currentTemplate, currentVariables);
			await showVariables();
		});
	}

	if (isSidePanel) {
		browser.runtime.sendMessage({ action: "sidePanelOpened" });

		window.addEventListener('unload', () => {
			browser.runtime.sendMessage({ action: "sidePanelClosed" });
		});
	}
}

function showError(messageKey: string): void {
	const errorMessage = document.querySelector('.error-message') as HTMLElement;
	const clipper = document.querySelector('.clipper') as HTMLElement;

	if (errorMessage && clipper) {
		errorMessage.textContent = getMessage(messageKey);
		errorMessage.style.display = 'flex';
		clipper.style.display = 'none';

		document.body.classList.add('has-error');
	}
}
function clearError(): void {
	const errorMessage = document.querySelector('.error-message') as HTMLElement;
	const clipper = document.querySelector('.clipper') as HTMLElement;

	if (errorMessage && clipper) {
		errorMessage.style.display = 'none';
		clipper.style.display = 'block';

		document.body.classList.remove('has-error');
	}
}

function logError(message: string, error?: any): void {
	console.error(message, error);
	showError(message);
}

async function waitForInterpreter(interpretBtn: HTMLButtonElement): Promise<void> {
	return new Promise((resolve, reject) => {
		const checkProcessing = () => {
			if (!interpretBtn.classList.contains('processing')) {
				if (interpretBtn.classList.contains('done')) {
					resolve();
				} else if (interpretBtn.classList.contains('error')) {
					reject(new Error(getMessage('failedToProcessInterpreter')));
				} else {
					setTimeout(checkProcessing, 100);
				}
			} else {
				setTimeout(checkProcessing, 100);
			}
		};
		checkProcessing();
	});
}

async function refreshFields(tabId: number, { checkTemplateTriggers = true, rebuildSkeleton = true }: { checkTemplateTriggers?: boolean; rebuildSkeleton?: boolean } = {}) {
	if (templates.length === 0) {
		console.warn('No templates available');
		showError('noTemplates');
		return;
	}

	try {
		const tab = await getTabInfo(tabId);
		if (!tab.url || isBlankPage(tab.url)) {
			showError('pageCannotBeClipped');
			return;
		}
		if (!isValidUrl(tab.url)) {
			showError('onlyHttpSupported');
			return;
		}
		if (isRestrictedUrl(tab.url)) {
			showError('pageCannotBeClipped');
			return;
		}

		// Start content extraction (don't await yet)
		const extractionPromise = memoizedExtractPageContent(tabId);

		// Match URL/regex triggers immediately (schema triggers will await extraction)
		if (checkTemplateTriggers) {
			const getSchemaOrgData = async () => {
				const data = await extractionPromise;
				return data?.schemaOrgData;
			};

			const matchedTemplate = await findMatchingTemplate(tab.url, getSchemaOrgData);
			if (matchedTemplate) {
				console.log('Matched template:', matchedTemplate);
				currentTemplate = matchedTemplate;
				updateTemplateDropdown();
			}
		}

		if (rebuildSkeleton) {
			buildTemplateFieldsSkeleton(currentTemplate);
			setupDestinationToggle();
		}

		const extractedData = await extractionPromise;
		if (extractedData) {
			const currentUrl = tab.url;

			const initializedContent = await initializePageContent(
				extractedData.content,
				extractedData.selectedHtml,
				extractedData.extractedContent,
				currentUrl,
				extractedData.schemaOrgData,
				extractedData.fullHtml,
				extractedData.highlights || [],
				extractedData.title,
				extractedData.author,
				extractedData.description,
				extractedData.favicon,
				extractedData.image,
				extractedData.published,
				extractedData.site,
				extractedData.wordCount,
				extractedData.language || '',
				extractedData.metaTags
			);
			if (initializedContent) {
				currentVariables = initializedContent.currentVariables;
				console.log('Updated currentVariables:', currentVariables);
				await fillTemplateFieldValues(
					tabId,
					currentTemplate,
					initializedContent.currentVariables,
					extractedData.schemaOrgData
				);

				// Update variables panel if it's open
				updateVariablesPanel(currentTemplate, currentVariables);
			} else {
				throw new Error('Unable to initialize page content.');
			}
		} else {
			throw new Error('Unable to extract page content.');
		}
	} catch (error) {
		console.error('Error refreshing fields:', error);
		const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
		showError(errorMessage);
	}
}

function updateTemplateDropdown() {
	const templateDropdown = document.getElementById('template-select') as HTMLSelectElement;
	if (templateDropdown && currentTemplate) {
		templateDropdown.value = currentTemplate.id;
	}
}

function populateTemplateDropdown() {
	const templateDropdown = document.getElementById('template-select') as HTMLSelectElement;
	if (templateDropdown && currentTemplate) {
		// Clear existing options
		templateDropdown.textContent = '';
		templates.forEach((template: Template) => {
			const option = document.createElement('option');
			option.value = template.id;
			option.textContent = template.name;
			templateDropdown.appendChild(option);
		});
		templateDropdown.value = currentTemplate.id;
	}
}

function buildTemplateFieldsSkeleton(template: Template | null) {
	if (!template) return;

	// Handle vault selection
	const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement;
	if (vaultDropdown) {
		if (template.vault) {
			vaultDropdown.value = template.vault;
		} else if (lastSelectedVault) {
			vaultDropdown.value = lastSelectedVault;
		}
	}

	const existingTemplateProperties = document.querySelector('.metadata-properties') as HTMLElement;

	const newTemplateProperties = createElementWithClass('div', 'metadata-properties');

	if (Array.isArray(template.properties)) {
		for (const property of template.properties) {
			const propertyDiv = createElementWithClass('div', 'metadata-property');
			const propertyType = generalSettings.propertyTypes.find(p => p.name === property.name)?.type || 'text';

			// Create metadata property key container
			const metadataPropertyKey = document.createElement('div');
			metadataPropertyKey.className = 'metadata-property-key';

			const propertyIconSpan = document.createElement('span');
			propertyIconSpan.className = 'metadata-property-icon';
			const iconElement = document.createElement('i');
			iconElement.setAttribute('data-lucide', getPropertyTypeIcon(propertyType));
			propertyIconSpan.appendChild(iconElement);

			const propertyLabel = document.createElement('label');
			propertyLabel.setAttribute('for', property.name);
			propertyLabel.textContent = property.name;

			metadataPropertyKey.appendChild(propertyIconSpan);
			metadataPropertyKey.appendChild(propertyLabel);

			// Create metadata property value container with empty input
			const metadataPropertyValue = document.createElement('div');
			metadataPropertyValue.className = 'metadata-property-value';

			const inputElement = document.createElement('input');
			inputElement.id = property.name;
			inputElement.setAttribute('data-type', propertyType);
			inputElement.setAttribute('data-template-value', property.value);
			inputElement.type = propertyType === 'checkbox' ? 'checkbox' : 'text';

            metadataPropertyKey.tabIndex = 0;
            metadataPropertyKey.setAttribute('role', 'button');
            metadataPropertyKey.title = getMessage('qiaomuCopyProperty');
            metadataPropertyKey.setAttribute('aria-label', `${property.name}: ${getMessage('qiaomuCopyProperty')}`);
            const copyValue = async (event: Event) => {
                event.preventDefault();
                try {
                    await navigator.clipboard.writeText(propertyType === 'checkbox' ? String(inputElement.checked) : inputElement.value);
                    const status = document.getElementById('clip-action-status');
                    if (status) status.textContent = `${property.name}: ${getMessage('copied')}`;
                } catch { metadataPropertyKey.title = getMessage('qiaomuCopyFailed'); }
            };
            metadataPropertyKey.addEventListener('click', copyValue);
            metadataPropertyKey.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') void copyValue(event);
            });
			metadataPropertyValue.appendChild(inputElement);

			propertyDiv.appendChild(metadataPropertyKey);
			propertyDiv.appendChild(metadataPropertyValue);
			newTemplateProperties.appendChild(propertyDiv);
		}
	}

	// Replace the existing element
	if (existingTemplateProperties && existingTemplateProperties.parentNode) {
		existingTemplateProperties.parentNode.replaceChild(newTemplateProperties, existingTemplateProperties);
		existingTemplateProperties.remove();
	}

	initializeIcons(newTemplateProperties);

	// Set up note name and path fields with template values
	const noteNameField = document.getElementById('note-name-field') as HTMLTextAreaElement;
	if (noteNameField) {
		noteNameField.setAttribute('data-template-value', template.noteNameFormat);
	}

	const pathField = document.getElementById('path-name-field') as HTMLInputElement;
	const pathContainer = document.querySelector('.vault-path-container') as HTMLElement;
	if (pathField && pathContainer) {
		const isDailyNote = template.behavior === 'append-daily' || template.behavior === 'prepend-daily';
		if (isDailyNote) {
			pathField.style.display = 'none';
		} else {
			pathContainer.style.display = 'flex';
			pathField.setAttribute('data-template-value', template.path);
		}
	}

	const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
	if (noteContentField) {
		noteContentField.setAttribute('data-template-value', template.noteContentFormat || '');
	}

	// Show/hide interpreter section based on template prompt variables
	const interpreterContainer = document.getElementById('interpreter');
	const interpretBtn = document.getElementById('interpret-btn');
	const hasPromptVars = generalSettings.interpreterEnabled && collectPromptVariables(template).length > 0;
	if (interpreterContainer) interpreterContainer.style.display = hasPromptVars ? 'flex' : 'none';
	if (interpretBtn) interpretBtn.style.display = hasPromptVars ? 'inline-block' : 'none';
	if (interpretBtn) {
		interpretBtn.classList.remove('done', 'error', 'processing');
		(interpretBtn as HTMLButtonElement).disabled = false;
		interpretBtn.textContent = getMessage('interpret');
	}
	interpreterContainer?.classList.remove('done', 'error');
	const interpreterError = document.getElementById('interpreter-error');
	if (interpreterError) interpreterError.style.display = 'none';

	// Populate model dropdown immediately (only needs generalSettings)
	if (hasPromptVars) {
		const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
		if (modelSelect) {
			const enabledModels = generalSettings.models.filter(model => model.enabled);
			modelSelect.textContent = '';
			enabledModels.forEach(model => {
				const option = document.createElement('option');
				option.value = model.id;
				option.textContent = model.name;
				modelSelect.appendChild(option);
			});
			// A stale saved model id would leave the select blank; fall back to the first enabled model.
			modelSelect.value = enabledModels.some(m => m.id === generalSettings.interpreterModel)
				? generalSettings.interpreterModel!
				: (enabledModels[0]?.id ?? '');
			modelSelect.style.display = 'inline-block';
		}
	}
}

async function fillTemplateFieldValues(currentTabId: number, template: Template | null, variables: { [key: string]: string }, schemaOrgData?: any) {
	if (!template) return;

	const currentUrl = currentTabId ? (await getTabInfo(currentTabId)).url || '' : '';

	currentVariables = variables;

	if (!Array.isArray(template.properties)) return;

	// Compile all templates in parallel
	const [compiledPropertyValues, formattedNoteName, formattedPath, formattedContent] = await Promise.all([
		Promise.all(template.properties.map(property =>
			memoizedCompileTemplate(currentTabId!, unescapeValue(property.value), variables, currentUrl)
		)),
		memoizedCompileTemplate(currentTabId!, template.noteNameFormat, variables, currentUrl),
		memoizedCompileTemplate(currentTabId!, template.path, variables, currentUrl),
		template.noteContentFormat
			? memoizedCompileTemplate(currentTabId!, template.noteContentFormat, variables, currentUrl)
			: Promise.resolve('')
	]);

	// Fill property values into existing DOM elements
	for (let i = 0; i < template.properties.length; i++) {
		const property = template.properties[i];
		const inputElement = document.getElementById(property.name) as HTMLInputElement;
		if (!inputElement) continue;

		let value = compiledPropertyValues[i];
		const propertyType = inputElement.getAttribute('data-type') || 'text';

		// Apply type-specific parsing
		value = formatPropertyValue(value, propertyType, property.value);

		if (propertyType === 'checkbox') {
			inputElement.checked = value === 'true';
		} else {
			inputElement.value = value;
		}
	}

	const noteNameField = document.getElementById('note-name-field') as HTMLTextAreaElement;
	if (noteNameField) {
		noteNameField.value = formattedNoteName.trim();
		adjustNoteNameHeight(noteNameField);
	}

	const pathField = document.getElementById('path-name-field') as HTMLInputElement;
	if (pathField) {
		pathField.value = formattedPath;
	}
	updateDestinationSummary();

	const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
	if (noteContentField) {
		noteContentField.value = template.noteContentFormat ? formattedContent : '';
	}

	if (generalSettings.interpreterEnabled) {
		await initializeInterpreter(template, variables, currentTabId!, currentUrl);

		const promptVariables = collectPromptVariables(template);

		if (generalSettings.interpreterAutoRun && promptVariables.length > 0) {
			try {
				const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
				const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
				const selectedModelId = modelSelect?.value || generalSettings.interpreterModel;
				const modelConfig = generalSettings.models.find(m => m.id === selectedModelId);
				if (!modelConfig) {
					throw new Error(`Model configuration not found for ${selectedModelId}`);
				}
				await handleInterpreterUI(template, variables, currentTabId!, currentUrl, modelConfig);

				if (interpretBtn) {
					interpretBtn.classList.add('done');
					interpretBtn.disabled = true;
				}
			} catch (error) {
				console.error('Error auto-processing with interpreter:', error);
				const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
				if (interpretBtn) {
					interpretBtn.classList.add('error');
				}
			}
		}
	}

	if (isDebugMode()) {
		const replacedTemplate = await getReplacedTemplate(template, variables, currentTabId!, currentUrl);
		debugLog('Variables', 'Current template with replaced variables:', JSON.stringify(replacedTemplate, null, 2));
	}
}

function updateDestinationSummary() {
	const summary = document.getElementById('destination-summary');
	if (!summary) return;
	const vault = (document.getElementById('vault-select') as HTMLSelectElement | null)?.value;
	const folder = (document.getElementById('path-name-field') as HTMLInputElement | null)?.value;
	summary.textContent = [vault, folder].filter(Boolean).join(' / ');
}

// Where the note is saved rarely changes, so show it as one summary line and expand on demand.
function setupDestinationToggle() {
	const toggle = document.getElementById('destination-toggle');
	const wrapper = toggle?.closest('.destination');
	if (!toggle || !wrapper || toggle.dataset.ready) return;
	toggle.dataset.ready = 'true';
	const flip = () => {
		const collapsed = wrapper.classList.toggle('collapsed');
		toggle.setAttribute('aria-expanded', String(!collapsed));
	};
	toggle.addEventListener('click', flip);
	toggle.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); } });
	document.getElementById('path-name-field')?.addEventListener('input', updateDestinationSummary);
	document.getElementById('vault-select')?.addEventListener('change', updateDestinationSummary);
	updateDestinationSummary();
}

async function getReplacedTemplate(template: Template, variables: { [key: string]: string }, tabId: number, currentUrl: string): Promise<any> {
	const replacedTemplate: any = {
		schemaVersion: "0.1.0",
		name: template.name,
		behavior: template.behavior,
		noteNameFormat: await compileTemplate(tabId, template.noteNameFormat, variables, currentUrl),
		path: template.path,
		noteContentFormat: await compileTemplate(tabId, template.noteContentFormat, variables, currentUrl),
		properties: [],
		triggers: template.triggers
	};

	if (template.context) {
		replacedTemplate.context = await compileTemplate(tabId, template.context, variables, currentUrl);
	}

	for (const prop of template.properties) {
		const replacedProp: Property = {
			id: prop.id,
			name: prop.name,
			value: await compileTemplate(tabId, prop.value, variables, currentUrl)
		};
		replacedTemplate.properties.push(replacedProp);
	}

	return replacedTemplate;
}

function updateVaultDropdown(vaults: string[]) {
	const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement | null;
	const vaultContainer = document.getElementById('vault-container');

	if (!vaultDropdown || !vaultContainer) return;

	// Clear existing options
	vaultDropdown.textContent = '';

	vaults.forEach(vault => {
		const option = document.createElement('option');
		option.value = vault;
		option.textContent = vault;
		vaultDropdown.appendChild(option);
	});

	// Only show vault selector if vaults are defined
	if (vaults.length > 0) {
		vaultContainer.style.display = 'block';
		if (lastSelectedVault && vaults.includes(lastSelectedVault)) {
			vaultDropdown.value = lastSelectedVault;
		} else {
			vaultDropdown.value = vaults[0];
		}
	} else {
		vaultContainer.style.display = 'none';
	}

	// Add event listener to update lastSelectedVault when changed
	vaultDropdown.addEventListener('change', () => {
		lastSelectedVault = vaultDropdown.value;
		setLocalStorage('lastSelectedVault', lastSelectedVault);
	});
}

function refreshPopup() {
	window.location.reload();
}

function handleTemplateChange(templateId: string) {
	currentTemplate = templates.find(t => t.id === templateId) || templates[0];
	refreshFields(currentTabId!, { checkTemplateTriggers: false });
}

function setReaderButtonState(isActive: boolean) {
	const readerButton = document.getElementById('reader-mode');
	if (readerButton) {
		readerButton.classList.toggle('active', isActive);
		readerButton.setAttribute('aria-pressed', isActive.toString());
		readerButton.title = isActive ? getMessage('disableReader') : getMessage('enableReader');
	}
}

async function checkReaderModeState(tabId: number) {
	try {
		// When embedded in a reader.html page, we know reader mode is active
		if (urlParams.get('readerUrl')) {
			setReaderButtonState(true);
			return;
		}

		// Query the actual page DOM via content script rather than
		// relying on background state, which can be stale across tabs
		const response = await browser.runtime.sendMessage({
			action: "sendMessageToTab",
			tabId: tabId,
			message: { action: "getReaderModeState" }
		}) as { isActive: boolean } | undefined;

		setReaderButtonState(response?.isActive ?? false);
	} catch (error) {
		// Tab may not have content script loaded yet
		console.error('Error checking reader mode state:', error);
	}
}

async function checkHighlighterModeState(tabId: number) {
	try {
		const response = await browser.runtime.sendMessage({
			action: "getHighlighterMode",
			tabId: tabId
		}) as { isActive: boolean };

		const isHighlighterMode = response.isActive;

		loadedSettings = await loadSettings();

		updateHighlighterModeUI(isHighlighterMode);
	} catch (error) {
		console.error('Error checking highlighter mode state:', error);
		// If there's an error, assume highlighter mode is off
		updateHighlighterModeUI(false);
	}
}

async function toggleHighlighterMode(tabId: number) {
	try {
		const response = await browser.runtime.sendMessage({
			action: "toggleHighlighterMode",
			tabId: tabId
		}) as { success: boolean, isActive: boolean, error?: string };

		if (response && response.success) {
			const isNowActive = response.isActive;
			updateHighlighterModeUI(isNowActive);

			// Close the popup if highlighter mode is turned on and not in side panel
			if (isNowActive && !isSidePanel && !isIframe) {
				setTimeout(() => window.close(), 50);
			}
		} else {
			throw new Error(response.error || "Failed to toggle highlighter mode.");
		}
	} catch (error) {
		console.error('Error toggling highlighter mode:', error);
		showError('failedToToggleHighlighter');
	}
}

function updateHighlighterModeUI(isActive: boolean) {
	const highlighterModeButton = document.getElementById('highlighter-mode');
	if (highlighterModeButton) {
		if (generalSettings.highlighterEnabled) {
			highlighterModeButton.style.display = 'flex';
			highlighterModeButton.classList.toggle('active', isActive);
			highlighterModeButton.setAttribute('aria-pressed', isActive.toString());
			highlighterModeButton.title = isActive ? getMessage('disableHighlighter') : getMessage('highlighterOn');
		} else {
			highlighterModeButton.style.display = 'none';
		}
	}
}

async function toggleReaderMode(tabId: number) {
	try {
		// When embedded in a reader.html page, pass the reader URL
		// so the background can navigate away even without tab URL access
		const response = await browser.runtime.sendMessage({
			action: "toggleReaderMode",
			tabId: tabId,
			readerUrl: urlParams.get('readerUrl') || undefined
		}) as ReaderModeResponse;

		if (response && response.success) {
			setReaderButtonState(response.isActive ?? false);
		}

		// Close the popup if not in side panel or iframe
		if (!isSidePanel && !isIframe) {
			window.close();
		}
	} catch (error) {
		console.error('Error toggling reader mode:', error);
		showError('failedToToggleReaderMode');
	}
}

export async function copyToClipboard(content: string) {
	try {
		try {
			await navigator.clipboard.writeText(content);
		} catch {
			await browser.runtime.sendMessage({
				action: 'copy-to-clipboard',
				text: content
			});
		}

		const pathField = document.getElementById('path-name-field') as HTMLInputElement;
		const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement;
		const path = pathField?.value || '';
		const vault = vaultDropdown?.value || '';

		const tabInfo = await getCurrentTabInfo();
		await incrementStat('copyToClipboard', vault, path, tabInfo.url, tabInfo.title);

        const status = document.getElementById('clip-action-status');
        if (status) {
            status.textContent = getMessage('copied');
            setTimeout(() => { status.textContent = ''; }, 1500);
        }
	} catch (error) {
		console.error('Failed to copy to clipboard:', error);
		showError('failedToCopyText');
	}
}

async function handleSaveToDownloads() {
	try {
		const noteNameField = document.getElementById('note-name-field') as HTMLInputElement;
		const pathField = document.getElementById('path-name-field') as HTMLInputElement;
		const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement;

		let fileName = noteNameField?.value || 'untitled';
		const path = pathField?.value || '';
		const vault = vaultDropdown?.value || '';

		const properties = getPropertiesFromDOM();

		const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
		const frontmatter = await generateFrontmatter(properties);
		const fileContent = frontmatter + noteContentField.value;

		await saveFile({
			content: fileContent,
			fileName,
			mimeType: 'text/markdown',
			tabId: currentTabId,
			onError: (error) => showError('failedToSaveFile')
		});

		const tabInfo = await getCurrentTabInfo();
		await incrementStat('saveFile', vault, path, tabInfo.url, tabInfo.title);

		const moreDropdown = document.getElementById('more-dropdown');
		if (moreDropdown) {
			moreDropdown.classList.remove('show');
		}
	} catch (error) {
		console.error('Failed to save file:', error);
		showError('failedToSaveFile');
	}
}

function determineMainAction() {
    const mainButton = document.getElementById('clip-btn');
    if (!mainButton) return;
    mainButton.textContent = getMessage('qiaomuClipToObsidian');
    mainButton.onclick = () => handleClipObsidian();
}

async function syncQiaomuClip(clip: QiaomuClip): Promise<boolean> {
	const status = document.getElementById('qiaomu-rss-status');
	const retry = document.getElementById('qiaomu-rss-retry') as HTMLButtonElement | null;
	if (status) status.textContent = t('正在提交到 RSS…');
	if (retry) { retry.hidden = true; retry.disabled = true; }
	let result: QiaomuResult;
	try { result = await browser.runtime.sendMessage({ action: 'qiaomuSubmitClip', clip }); }
	catch { result = { error: t('RSS 同步中断，请重试') }; }
	if (status) status.textContent = result?.accepted ? t('已收录到 RSS · 读者提交') : result?.error || t('RSS 同步失败，请重试');
	if (retry) { retry.hidden = Boolean(result?.accepted); retry.disabled = false; }
	pendingQiaomuClip = result?.accepted ? null : clip;
	return Boolean(result?.accepted);
}

async function initializeQiaomuRss(): Promise<void> {
	const checkbox = document.getElementById('qiaomu-rss-enabled') as HTMLInputElement | null;
	const retry = document.getElementById('qiaomu-rss-retry') as HTMLButtonElement | null;
	const saved = await browser.storage.local.get(null);
	const localStatus = document.getElementById('qiaomu-local-status');
	const localRetry = document.getElementById('qiaomu-local-retry') as HTMLButtonElement | null;
	let nativeStatus: { ok?: boolean; vaultPath?: string; vault?: string; reason?: string } = {};
	try { nativeStatus = await browser.runtime.sendMessage({ action: 'qiaomuLocalStatus' }); } catch { /* URI mode remains available for clients without the helper */ }
	nativeLocalSave = Boolean(nativeStatus?.ok || saved.qiaomuNativeConfigured);
	if (nativeStatus?.ok) {
		await browser.storage.local.set({ qiaomuNativeConfigured: true });
		if (localStatus) localStatus.textContent = '';
	} else if (nativeLocalSave && localStatus) {
		localStatus.textContent = t('{0}复制修复指令，发给你的 AI 助手（Codex、Claude Code、WorkBuddy、豆包等）即可自动修复。', [describeHelperFailure(nativeStatus?.reason)]);
		const fix = document.getElementById('qiaomu-local-fix') as HTMLButtonElement | null;
		if (fix) {
			fix.hidden = false;
			fix.addEventListener('click', async () => {
				try { await navigator.clipboard.writeText(nativeHelperRepairPrompt(browser.runtime.id, nativeStatus?.reason)); fix.textContent = t('已复制，去发给 AI 助手'); }
				catch { fix.textContent = t('复制失败，请手动查看 native/README.md'); }
			});
		}
	}
	const localPendingKey = Object.keys(saved).find(key => key.startsWith('qiaomuLocalPending:'));
	if (localPendingKey) {
		pendingLocalSave = saved[localPendingKey] as LocalSavePayload;
		if (localStatus) localStatus.textContent = t('有未保存的本地笔记：{0}', [pendingLocalSave.name]);
		if (localRetry) localRetry.hidden = false;
	}
	if (localRetry) localRetry.addEventListener('click', () => { if (pendingLocalSave) void syncLocalClip(pendingLocalSave); });
	const pendingKey = Object.keys(saved).find(key => key.startsWith('qiaomuPending:'));
	const pending = pendingKey ? saved[pendingKey] as QiaomuClip : null;
	if (checkbox) {
		checkbox.checked = saved.qiaomuRssEnabled === true;
		checkbox.addEventListener('change', () => { void browser.storage.local.set({ qiaomuRssEnabled: checkbox.checked }); });
	}
	if (pending) {
		pendingQiaomuClip = pending;
		const status = document.getElementById('qiaomu-rss-status');
		if (status) status.textContent = t('有未同步的剪藏：{0}', [pendingQiaomuClip?.title || '']);
		if (retry) retry.hidden = false;
	}
	if (retry) retry.addEventListener('click', () => { if (pendingQiaomuClip) void syncQiaomuClip(pendingQiaomuClip); });
}

async function syncLocalClip(payload: LocalSavePayload): Promise<boolean> {
	const status = document.getElementById('qiaomu-local-status');
	const retry = document.getElementById('qiaomu-local-retry') as HTMLButtonElement | null;
	if (status) status.textContent = t('正在保存到本地…');
	if (retry) { retry.hidden = true; retry.disabled = true; }
	const result = await saveLocalClip(payload);
	if (status) status.textContent = result?.ok ? t('已保存：{0} / {1}', [result.vault, result.relativePath]) : result?.error || t('本地保存失败，请重试');
	pendingLocalSave = result?.ok ? null : payload;
	if (retry) { retry.hidden = Boolean(result?.ok); retry.disabled = false; }
	return Boolean(result?.ok);
}

// Once everything is saved, get out of the way: close the embedded panel on the page, or the popup.
function closeAfterSuccess() {
	setTimeout(() => {
		if (isIframe) browser.runtime.sendMessage({ action: 'closeIframe' }).catch(() => {});
		else if (!isSidePanel) window.close();
	}, 1200);
}

async function handleClipObsidian(forceOpen = false): Promise<void> {
	if (!currentTemplate || clipInProgress) return;

	const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement;
	const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
	const noteNameField = document.getElementById('note-name-field') as HTMLInputElement;
	const pathField = document.getElementById('path-name-field') as HTMLInputElement;
	const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;

	if (!vaultDropdown || !noteContentField) {
		showError('Some required fields are missing. Please try reloading the extension.');
		return;
	}

	clipInProgress = true;
	const clipButton = document.getElementById('clip-btn') as HTMLButtonElement | null;
	if (clipButton) clipButton.disabled = true;
	try {
		// Handle interpreter if needed
		if (generalSettings.interpreterEnabled && interpretBtn && collectPromptVariables(currentTemplate).length > 0) {
			if (interpretBtn.classList.contains('processing')) {
				await waitForInterpreter(interpretBtn);
			} else if (!interpretBtn.classList.contains('done')) {
				interpretBtn.click();
				await waitForInterpreter(interpretBtn);
			}
		}

		// Gather content
		const properties = getPropertiesFromDOM();

		const frontmatter = await generateFrontmatter(properties);
		const fileContent = frontmatter + noteContentField.value;

		// Save to Obsidian
		const selectedVault = vaultDropdown.value || currentTemplate.vault || '';
		const isDailyNote = currentTemplate.behavior === 'append-daily' || currentTemplate.behavior === 'prepend-daily';
		const noteName = isDailyNote ? '' : noteNameField?.value || '';
		const path = isDailyNote ? '' : pathField?.value || '';

		const aggregate = (document.getElementById('qiaomu-rss-enabled') as HTMLInputElement | null)?.checked === true;
		const tabInfo = await getCurrentTabInfo();
		if (nativeLocalSave && !forceOpen) {
			const localSaved = await syncLocalClip({ requestId: crypto.randomUUID(), content: fileContent, name: `${sanitizeFileName(noteNameField?.value || 'Untitled')}.md`, folder: pathField?.value || '', vault: selectedVault, behavior: currentTemplate.behavior });
			const rssSaved = aggregate ? await syncQiaomuClip({ url: tabInfo.url, title: noteNameField?.value || tabInfo.title || t('剪藏'), markdown: noteContentField.value, image: tabInfo.image }) : true;
			if (localSaved) {
				await incrementStat('addToObsidian', selectedVault, path, tabInfo.url, tabInfo.title);
				lastSelectedVault = selectedVault;
				await setLocalStorage('lastSelectedVault', lastSelectedVault);
				if (rssSaved) closeAfterSuccess();
			}
			return;
		}
		// Start worker-owned sync before opening Obsidian, which can dismiss the popup.
		let rssSaved = true;
		if (aggregate) rssSaved = await syncQiaomuClip({ url: tabInfo.url, title: noteNameField?.value || tabInfo.title || t('剪藏'), markdown: noteContentField.value, image: tabInfo.image });
		await saveToObsidian(fileContent, noteName, path, selectedVault, currentTemplate.behavior);
		await incrementStat('addToObsidian', selectedVault, path, tabInfo.url, tabInfo.title);

		lastSelectedVault = selectedVault;
		await setLocalStorage('lastSelectedVault', lastSelectedVault);

		if (rssSaved) closeAfterSuccess();
	} catch (error) {
		console.error('Error in handleClipObsidian:', error);
		showError('failedToSaveFile');
	} finally {
		clipInProgress = false;
		if (clipButton) clipButton.disabled = false;
	}
}

function addSecondaryAction(container: Element, actionType: string, handler: () => void) {
	const menuItem = document.createElement('div');
	menuItem.className = 'menu-item';

	// Create menu item icon container
	const menuItemIcon = document.createElement('div');
	menuItemIcon.className = 'menu-item-icon';

	const iconElement = document.createElement('i');
	iconElement.setAttribute('data-lucide', getActionIcon(actionType));
	menuItemIcon.appendChild(iconElement);

	// Create menu item title
	const menuItemTitle = document.createElement('div');
	menuItemTitle.className = 'menu-item-title';
	menuItemTitle.setAttribute('data-i18n', actionType);
	menuItemTitle.textContent = getMessage(actionType);

	// Assemble menu item
	menuItem.appendChild(menuItemIcon);
	menuItem.appendChild(menuItemTitle);

	menuItem.addEventListener('click', handler);
	container.appendChild(menuItem);
	initializeIcons(menuItem);
}

function getActionIcon(actionType: string): string {
	switch (actionType) {
		case 'copyToClipboard': return 'copy';
		case 'saveFile': return 'file-down';
		case 'addToObsidian': return 'pen-line';
		default: return 'plus';
	}
}

async function copyContent() {
	const properties = getPropertiesFromDOM();

	const noteContentField = document.getElementById('note-content-field') as HTMLTextAreaElement;
	const frontmatter = await generateFrontmatter(properties);
	const fileContent = frontmatter + noteContentField.value;
	await copyToClipboard(fileContent);
}

// Update the resize event listener to use the debounced version
window.addEventListener('resize', debouncedSetPopupDimensions);

function setupCompactPopup() {
    document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
        element.setAttribute('aria-label', getMessage(element.getAttribute('data-i18n-aria-label')!));
    });
    const toggle = document.getElementById('popup-tools-toggle') as HTMLButtonElement;
    const menu = document.getElementById('popup-tools-menu') as HTMLElement;
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    // Turn the triple-press shortcuts off (or back on) for the site of the current page.
    const siteLabel = document.getElementById('toggle-triple-site-label');
    let siteHost = '';
    const refreshSiteItem = async () => {
        try { siteHost = new URL((await getCurrentTabInfo()).url).hostname.replace(/^www\./, ''); } catch { siteHost = ''; }
        const item = document.getElementById('toggle-triple-site');
        if (item) item.hidden = !siteHost;
        if (siteLabel && siteHost) siteLabel.textContent = getMessage(isSiteBlocked(siteHost, generalSettings.tripleKeyBlockedSites) ? 'tripleKeySiteOn' : 'tripleKeySiteOff', siteHost);
    };
    document.getElementById('toggle-triple-site')?.addEventListener('click', async event => {
        event.preventDefault();
        if (!siteHost) return;
        const list = normalizeSites(generalSettings.tripleKeyBlockedSites);
        const blocked = isSiteBlocked(siteHost, list);
        const next = blocked ? list.filter(site => siteHost !== site && !siteHost.endsWith(`.${site}`)) : [...list, siteHost];
        await saveSettings({ ...generalSettings, tripleKeyBlockedSites: next });
        const status = document.getElementById('clip-action-status');
        if (status) status.textContent = getMessage(blocked ? 'tripleKeySiteEnabled' : 'tripleKeySiteDisabled', siteHost);
    });
    toggle.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        if (!menu.hidden) void refreshSiteItem();
        toggle.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    document.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('.popup-tools')) close(); });
    menu.addEventListener('click', close);
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { close(); toggle.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
    });
    document.getElementById('edit-clip-markdown')?.addEventListener('click', event => {
        event.preventDefault();
        document.getElementById('open-editor')?.click();
    });
    document.getElementById('open-editor')?.addEventListener('click', async () => {
        if (!currentTemplate) return;
        const button = document.getElementById('open-editor') as HTMLButtonElement;
        button.disabled = true;
        try {
            const markdown = (document.getElementById('note-content-field') as HTMLTextAreaElement).value;
            const name = (document.getElementById('note-name-field') as HTMLTextAreaElement).value || 'Untitled';
            const tab = await getCurrentTabInfo();
            const properties = getPropertiesFromDOM();
            await openClipPreview({
                local: { requestId: crypto.randomUUID(), content: await generateFrontmatter(properties) + markdown, name: `${sanitizeFileName(name)}.md`, folder: (document.getElementById('path-name-field') as HTMLInputElement).value, vault: (document.getElementById('vault-select') as HTMLSelectElement).value || currentTemplate.vault || '', behavior: currentTemplate.behavior },
                clip: { url: tab.url, title: name, markdown, image: tab.image },
                aggregate: (document.getElementById('qiaomu-rss-enabled') as HTMLInputElement).checked,
                native: nativeLocalSave,
                properties,
            }, 'editor.html?id=');
        } catch (error) {
            const status = document.getElementById('clip-action-status');
            if (status) status.textContent = String(error);
        } finally { button.disabled = false; }
    });
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            (document.getElementById('clip-btn') as HTMLButtonElement | null)?.click();
        }
    });
    document.getElementById('preview-clip')?.addEventListener('click', async () => {
        // On a video or audio page, Read opens the study player, exactly as the triple-press and the toolbar icon do.
        const study = await browser.runtime.sendMessage({ action: 'qiaomuOpenStudy' }).catch(() => undefined) as { opened?: boolean } | undefined;
        if (study?.opened) { void browser.runtime.sendMessage({ action: 'closeIframe' }).catch(() => {}); window.close(); return; }
        if (!currentTemplate) return;
        const button = document.getElementById('preview-clip') as HTMLButtonElement;
        button.disabled = true;
        try {
            const markdown = (document.getElementById('note-content-field') as HTMLTextAreaElement).value;
            const name = (document.getElementById('note-name-field') as HTMLTextAreaElement).value || 'Untitled';
            const tab = await getCurrentTabInfo();
            const content = await generateFrontmatter(getPropertiesFromDOM()) + markdown;
            await openClipPreview({
                local: { requestId: crypto.randomUUID(), content, name: `${sanitizeFileName(name)}.md`, folder: (document.getElementById('path-name-field') as HTMLInputElement).value, vault: (document.getElementById('vault-select') as HTMLSelectElement).value || currentTemplate.vault || '', behavior: currentTemplate.behavior },
                clip: { url: tab.url, title: name, markdown, image: tab.image },
                aggregate: (document.getElementById('qiaomu-rss-enabled') as HTMLInputElement).checked,
                native: nativeLocalSave,
                properties: getPropertiesFromDOM(),
            });
        } catch (error) {
            const status = document.getElementById('clip-action-status');
            if (status) status.textContent = String(error);
        } finally { button.disabled = false; }
    });
}
