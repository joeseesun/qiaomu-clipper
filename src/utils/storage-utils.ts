import { decodeInterpreterSettings, encodeInterpreterSettings, interpreterChunkKeys, INTERPRETER_KEY } from './interpreter-storage';
import browser from './browser-polyfill';
import { Settings, ModelConfig, PropertyType, HistoryEntry, Provider, Rating, OAuthCredentials } from '../types/types';
import { debugLog } from './debug';
import type { OAuthStore } from './oauth/accounts';

export type { Settings, ModelConfig, PropertyType, HistoryEntry, Provider, Rating };

export let generalSettings: Settings = {
	vaults: [],
	betaFeatures: false,
	legacyMode: false,
	silentOpen: false,
	openBehavior: 'popup',
	highlighterEnabled: true,
	alwaysShowHighlights: false,
	highlightBehavior: 'highlight-inline',
	showMoreActionsButton: false,
	interpreterModel: '',
	models: [],
	providers: [],
	interpreterEnabled: false,
	interpreterAutoRun: false,
	defaultPromptContext: '',
	propertyTypes: [],
	readerSettings: {
		fontSize: 16,
		lineHeight: 1.6,
		maxWidth: 38,
		lightTheme: 'default',
		darkTheme: 'same',
		appearance: 'auto',
		fonts: [],
		defaultFont: '',
		blendImages: true,
		colorLinks: false,
		followLinks: true,
		pinPlayer: true,
		autoScroll: true,
		highlightActiveLine: true,
		customCss: ''
	},
	stats: {
		addToObsidian: 0,
		saveFile: 0,
		copyToClipboard: 0,
		share: 0,
		readerMode: 0
	},
	history: [],
	ratings: [],
	saveBehavior: 'addToObsidian'
};

export function setLocalStorage(key: string, value: any): Promise<void> {
	return browser.storage.local.set({ [key]: value });
}

export function getLocalStorage(key: string): Promise<any> {
	return browser.storage.local.get(key).then((result: {[key: string]: any}) => result[key]);
}

interface StorageData {
	general_settings?: {
		showMoreActionsButton?: boolean;
		betaFeatures?: boolean;
		legacyMode?: boolean;
		silentOpen?: boolean;
		openBehavior?: boolean | 'popup' | 'embedded' | 'reader';
		saveBehavior?: 'addToObsidian' | 'copyToClipboard' | 'saveFile';
		defaultTemplateId?: string;
		tripleKeyShortcuts?: boolean;
		tripleKeys?: { read: string; edit: string; clip: string; note?: string; write?: string };
		tripleKeyBlockedSites?: string[];
		selectionToolbar?: boolean;
		readerAutoChat?: boolean;
		editorAutoChat?: boolean;
		youtubePanelActions?: boolean;
		learningNotes?: boolean;
		learningIncludeQuote?: boolean;
		learningIncludeSource?: boolean;
		youtubeAutoTranscript?: boolean;
		captionDownloadFormat?: 'ask' | 'md' | 'srt' | 'vtt' | 'txt';
		youtubeHideNativeTranscript?: boolean;
	};
	vaults?: string[];
	highlighter_settings?: {
		highlighterEnabled?: boolean;
		alwaysShowHighlights?: boolean;
		highlightBehavior?: string;
	};
	reader_settings?: {
		fontSize?: number;
		lineHeight?: number;
		maxWidth?: number;
		lightTheme?: string;
		darkTheme?: string;
		appearance?: 'auto' | 'light' | 'dark';
		fonts?: string[];
		defaultFont?: string;
		blendImages?: boolean;
		colorLinks?: boolean;
		followLinks?: boolean;
		pinPlayer?: boolean;
		autoScroll?: boolean;
		highlightActiveLine?: boolean;
		customCss?: string;
	};
	interpreter_settings?: {
		interpreterModel?: string;
		models?: ModelConfig[];
		providers?: Provider[];
		interpreterEnabled?: boolean;
		interpreterAutoRun?: boolean;
		defaultPromptContext?: string;
	};
	property_types?: PropertyType[];
	stats?: {
		addToObsidian: number;
		saveFile: number;
		copyToClipboard: number;
		share: number;
		readerMode?: number;
	};
	history?: HistoryEntry[];
	ratings?: Rating[];
	migrationVersion?: number;
}

const CURRENT_MIGRATION_VERSION = 1;

export async function loadSettings(): Promise<Settings> {
	const raw = await browser.storage.sync.get(null);
	const data = { ...raw, interpreter_settings: decodeInterpreterSettings(raw) } as StorageData;
	
	// Load default settings first
	const defaultSettings: Settings = {
		vaults: [],
		showMoreActionsButton: false,
		betaFeatures: false,
		legacyMode: false,
		silentOpen: false,
		openBehavior: 'popup',
		highlighterEnabled: true,
		alwaysShowHighlights: true,
		highlightBehavior: 'highlight-inline',
		interpreterModel: '',
		models: [],
		providers: [],
		interpreterEnabled: false,
		interpreterAutoRun: false,
		defaultPromptContext: '',
		propertyTypes: [],
		saveBehavior: 'addToObsidian',
		readerSettings: {
			fontSize: 16,
			lineHeight: 1.6,
			maxWidth: 38,
			lightTheme: 'default',
			darkTheme: 'same',
			appearance: 'auto',
			fonts: [],
			defaultFont: '',
			blendImages: true,
			colorLinks: false,
			followLinks: true,
			pinPlayer: true,
			autoScroll: true,
			highlightActiveLine: true,
			customCss: ''
		},
		stats: {
			addToObsidian: 0,
			saveFile: 0,
			copyToClipboard: 0,
			share: 0,
			readerMode: 0
		},
		history: [],
		ratings: [],
	};

	// Update migration version if needed
	if (!data.migrationVersion || data.migrationVersion < CURRENT_MIGRATION_VERSION) {
		await browser.storage.sync.set({ migrationVersion: CURRENT_MIGRATION_VERSION });
		debugLog('Settings', `Updated migration version to ${CURRENT_MIGRATION_VERSION}`);
	}

	// Validate and sanitize data to prevent corruption
	const sanitizedVaults = Array.isArray(data.vaults) ? data.vaults.filter(v => typeof v === 'string') : [];
	const sanitizedModels = Array.isArray(data.interpreter_settings?.models) 
		? data.interpreter_settings.models.filter(m => m && typeof m === 'object' && typeof m.id === 'string') 
		: [];
	const sanitizedProviders = Array.isArray(data.interpreter_settings?.providers) 
		? data.interpreter_settings.providers.filter(p => p && typeof p === 'object' && typeof p.id === 'string') 
		: [];

	// Load user settings
	const loadedSettings: Settings = {
		vaults: sanitizedVaults.length > 0 ? sanitizedVaults : defaultSettings.vaults,
		showMoreActionsButton: data.general_settings?.showMoreActionsButton ?? defaultSettings.showMoreActionsButton,
		betaFeatures: data.general_settings?.betaFeatures ?? defaultSettings.betaFeatures,
		legacyMode: data.general_settings?.legacyMode ?? defaultSettings.legacyMode,
		silentOpen: data.general_settings?.silentOpen ?? defaultSettings.silentOpen,
		// The in-page panel option was removed: anyone who had it gets the popup.
		openBehavior: data.general_settings?.openBehavior === 'reader' ? 'reader' : 'popup',
		defaultTemplateId: data.general_settings?.defaultTemplateId,
		tripleKeyShortcuts: data.general_settings?.tripleKeyShortcuts ?? true,
		tripleKeys: data.general_settings?.tripleKeys,
		tripleKeyBlockedSites: data.general_settings?.tripleKeyBlockedSites,
		selectionToolbar: data.general_settings?.selectionToolbar ?? true,
		readerAutoChat: data.general_settings?.readerAutoChat ?? false,
		editorAutoChat: data.general_settings?.editorAutoChat ?? false,
		youtubePanelActions: data.general_settings?.youtubePanelActions ?? true,
		learningNotes: data.general_settings?.learningNotes ?? true,
		learningIncludeQuote: data.general_settings?.learningIncludeQuote ?? true,
		learningIncludeSource: data.general_settings?.learningIncludeSource ?? true,
		youtubeAutoTranscript: data.general_settings?.youtubeAutoTranscript ?? true,
		captionDownloadFormat: (['md', 'srt', 'vtt', 'txt'] as const).find(format => format === data.general_settings?.captionDownloadFormat) ?? 'ask',
		youtubeHideNativeTranscript: data.general_settings?.youtubeHideNativeTranscript ?? true,
		highlighterEnabled: data.highlighter_settings?.highlighterEnabled ?? defaultSettings.highlighterEnabled,
		alwaysShowHighlights: data.highlighter_settings?.alwaysShowHighlights ?? defaultSettings.alwaysShowHighlights,
		highlightBehavior: data.highlighter_settings?.highlightBehavior ?? defaultSettings.highlightBehavior,
		interpreterModel: data.interpreter_settings?.interpreterModel || defaultSettings.interpreterModel,
		models: sanitizedModels,
		providers: sanitizedProviders,
		interpreterEnabled: data.interpreter_settings?.interpreterEnabled ?? defaultSettings.interpreterEnabled,
		interpreterAutoRun: data.interpreter_settings?.interpreterAutoRun ?? defaultSettings.interpreterAutoRun,
		defaultPromptContext: data.interpreter_settings?.defaultPromptContext || defaultSettings.defaultPromptContext,
		propertyTypes: data.property_types || defaultSettings.propertyTypes,
		readerSettings: {
			fontSize: data.reader_settings?.fontSize ?? defaultSettings.readerSettings.fontSize,
			lineHeight: data.reader_settings?.lineHeight ?? defaultSettings.readerSettings.lineHeight,
			maxWidth: data.reader_settings?.maxWidth ?? defaultSettings.readerSettings.maxWidth,
			lightTheme: data.reader_settings?.lightTheme ?? defaultSettings.readerSettings.lightTheme,
			darkTheme: data.reader_settings?.darkTheme ?? defaultSettings.readerSettings.darkTheme,
			appearance: data.reader_settings?.appearance as 'auto' | 'light' | 'dark' ?? defaultSettings.readerSettings.appearance,
			fonts: data.reader_settings?.fonts ?? defaultSettings.readerSettings.fonts,
			defaultFont: data.reader_settings?.defaultFont ?? defaultSettings.readerSettings.defaultFont,
			blendImages: data.reader_settings?.blendImages ?? defaultSettings.readerSettings.blendImages,
			colorLinks: data.reader_settings?.colorLinks ?? defaultSettings.readerSettings.colorLinks,
			followLinks: data.reader_settings?.followLinks ?? defaultSettings.readerSettings.followLinks,
			pinPlayer: data.reader_settings?.pinPlayer ?? defaultSettings.readerSettings.pinPlayer,
			autoScroll: data.reader_settings?.autoScroll ?? defaultSettings.readerSettings.autoScroll,
			highlightActiveLine: data.reader_settings?.highlightActiveLine ?? defaultSettings.readerSettings.highlightActiveLine,
			customCss: data.reader_settings?.customCss ?? defaultSettings.readerSettings.customCss
		},
		stats: { ...defaultSettings.stats, ...data.stats },
		history: data.history || defaultSettings.history,
		ratings: data.ratings || defaultSettings.ratings,
		saveBehavior: data.general_settings?.saveBehavior ?? defaultSettings.saveBehavior
	};

	generalSettings = loadedSettings;
	rememberOAuth(generalSettings.providers);
	debugLog('Settings', 'Loaded settings:', generalSettings);
	return generalSettings;
}

// The refresh token each provider had when this page last read or wrote settings. Refresh tokens rotate,
// so a page that did not change a sign-in must not write its older copy back over a newer one.
const oauthSeen = new Map<string, string>();
const oauthMark = (provider: Provider) => provider.oauth?.refresh || '';
function rememberOAuth(providers: Provider[]): void {
	oauthSeen.clear();
	for (const provider of providers) oauthSeen.set(provider.id, oauthMark(provider));
}

// Settings are written whole from each page's copy; one writer at a time keeps the read-merge-write intact.
function oneWriter<T>(work: () => Promise<T>): Promise<T> {
	return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('qiaomu-settings-write', work) as Promise<T> : work();
}

function storedProviders(raw: Record<string, unknown>): Provider[] {
	try { return decodeInterpreterSettings(raw)?.providers || []; } catch { return []; }
}

async function writeInterpreterSettings(encoded: Record<string, unknown>, previous: unknown, rest: Record<string, unknown> = {}): Promise<void> {
	await browser.storage.sync.set({ ...rest, ...encoded });
	const currentKeys = new Set(Object.keys(encoded));
	const stale = interpreterChunkKeys(previous).filter(key => !currentKeys.has(key));
	// Settings are already saved; cleanup failure must not turn success into a retry.
	if (stale.length) await browser.storage.sync.remove(stale).catch(() => {});
}

async function storedOAuth(providerId: string): Promise<OAuthCredentials | undefined> {
	return storedProviders(await browser.storage.sync.get(null)).find(p => p.id === providerId)?.oauth;
}

// Writes one provider's renewed credentials into the stored settings, leaving everything else as stored.
async function saveProviderOAuth(providerId: string, oauth: OAuthCredentials): Promise<void> {
	await oneWriter(async () => {
		const raw = await browser.storage.sync.get(null);
		const stored = decodeInterpreterSettings(raw);
		const provider = stored?.providers?.find(p => p.id === providerId);
		// Removed or signed out on another page meanwhile: that choice stands.
		if (!stored || !provider?.oauth) return;
		provider.oauth = oauth;
		await writeInterpreterSettings(encodeInterpreterSettings(stored), raw[INTERPRETER_KEY]);
	});
	const mine = generalSettings.providers.find(p => p.id === providerId);
	if (mine) mine.oauth = oauth;
	oauthSeen.set(providerId, oauth.refresh);
}

export const oauthStore: OAuthStore = { load: storedOAuth, save: saveProviderOAuth };

export async function saveSettings(settings?: Partial<Settings>): Promise<void> {
	if (settings) {
		generalSettings = { ...generalSettings, ...settings };
	}
	await oneWriter(writeSettings);
}

async function writeSettings(): Promise<void> {
	const raw = await browser.storage.sync.get(null);
	const latest = storedProviders(raw);
	for (const provider of generalSettings.providers) {
		const stored = latest.find(p => p.id === provider.id);
		// Only sign-ins this page changed are written; the rest follow what is stored now.
		if (!stored || oauthSeen.get(provider.id) !== oauthMark(provider) || oauthMark(stored) === oauthMark(provider)) continue;
		if (stored.oauth) provider.oauth = stored.oauth; else delete provider.oauth;
	}

	const interpreterSettings = {
		interpreterModel: generalSettings.interpreterModel,
		models: generalSettings.models,
		providers: generalSettings.providers,
		interpreterEnabled: generalSettings.interpreterEnabled,
		interpreterAutoRun: generalSettings.interpreterAutoRun,
		defaultPromptContext: generalSettings.defaultPromptContext
	};
	await writeInterpreterSettings(encodeInterpreterSettings(interpreterSettings), raw[INTERPRETER_KEY], {
		vaults: generalSettings.vaults,
		general_settings: {
			showMoreActionsButton: generalSettings.showMoreActionsButton,
			betaFeatures: generalSettings.betaFeatures,
			legacyMode: generalSettings.legacyMode,
			silentOpen: generalSettings.silentOpen,
			openBehavior: generalSettings.openBehavior,
			saveBehavior: generalSettings.saveBehavior,
			defaultTemplateId: generalSettings.defaultTemplateId,
			tripleKeyShortcuts: generalSettings.tripleKeyShortcuts,
			tripleKeys: generalSettings.tripleKeys,
			tripleKeyBlockedSites: generalSettings.tripleKeyBlockedSites,
			selectionToolbar: generalSettings.selectionToolbar,
			readerAutoChat: generalSettings.readerAutoChat,
			editorAutoChat: generalSettings.editorAutoChat,
			youtubePanelActions: generalSettings.youtubePanelActions,
			learningNotes: generalSettings.learningNotes,
			learningIncludeQuote: generalSettings.learningIncludeQuote,
			learningIncludeSource: generalSettings.learningIncludeSource,
			youtubeAutoTranscript: generalSettings.youtubeAutoTranscript,
			captionDownloadFormat: generalSettings.captionDownloadFormat,
			youtubeHideNativeTranscript: generalSettings.youtubeHideNativeTranscript,
		},
		highlighter_settings: {
			highlighterEnabled: generalSettings.highlighterEnabled,
			alwaysShowHighlights: generalSettings.alwaysShowHighlights,
			highlightBehavior: generalSettings.highlightBehavior
		},
		property_types: generalSettings.propertyTypes,
		reader_settings: {
			fontSize: generalSettings.readerSettings.fontSize,
			lineHeight: generalSettings.readerSettings.lineHeight,
			maxWidth: generalSettings.readerSettings.maxWidth,
			lightTheme: generalSettings.readerSettings.lightTheme,
			darkTheme: generalSettings.readerSettings.darkTheme,
			appearance: generalSettings.readerSettings.appearance,
			fonts: generalSettings.readerSettings.fonts,
			defaultFont: generalSettings.readerSettings.defaultFont,
			blendImages: generalSettings.readerSettings.blendImages,
			colorLinks: generalSettings.readerSettings.colorLinks,
			followLinks: generalSettings.readerSettings.followLinks,
			pinPlayer: generalSettings.readerSettings.pinPlayer,
			autoScroll: generalSettings.readerSettings.autoScroll,
			highlightActiveLine: generalSettings.readerSettings.highlightActiveLine,
			customCss: generalSettings.readerSettings.customCss
		},
		stats: generalSettings.stats
	});
	rememberOAuth(generalSettings.providers);
}

export async function setLegacyMode(enabled: boolean): Promise<void> {
	await saveSettings({ legacyMode: enabled });
	console.log(`Legacy mode ${enabled ? 'enabled' : 'disabled'}`);
}

export async function incrementStat(
	action: keyof Settings['stats'],
	vault?: string,
	path?: string,
	url?: string,
	title?: string
): Promise<void> {
	const settings = await loadSettings();
	settings.stats[action]++;
	await saveSettings(settings);

	// Add history entry if URL is provided
	if (url) {
		await addHistoryEntry(action, url, title, vault, path);
	}
}

export async function addHistoryEntry(
	action: keyof Settings['stats'], 
	url: string, 
	title?: string,
	vault?: string,
	path?: string
): Promise<void> {
	const entry: HistoryEntry = {
		datetime: new Date().toISOString(),
		url,
		action,
		title,
		vault,
		path
	};

	// Get existing history from local storage
	const result = await browser.storage.local.get('history');
	const history: HistoryEntry[] = (result.history || []) as HistoryEntry[];

	// Add new entry at the beginning
	history.unshift(entry);

	// Keep only the last 1000 entries
	const trimmedHistory = history.slice(0, 1000);

	// Save back to local storage
	await browser.storage.local.set({ history: trimmedHistory });
}

export async function getClipHistory(): Promise<HistoryEntry[]> {
	const result = await browser.storage.local.get('history');
	return (result.history || []) as HistoryEntry[];
}

declare global {
	interface Window {
		debugStorage: (key?: string) => Promise<Record<string, unknown>>;
	}
}

// Make storage accessible from console — use `window.debugStorage()` to see all sync storage, or `window.debugStorage(key)` to see a specific key
if (typeof window !== 'undefined') {
	window.debugStorage = (key?: string) => {
		if (key) {
			return browser.storage.sync.get(key).then(data => {
				console.log(`Sync storage contents for key "${key}":`, data);
				return data;
			});
		}
		return browser.storage.sync.get(null).then(data => {
			console.log('Sync storage contents:', data);
			return data;
		});
	};
}
