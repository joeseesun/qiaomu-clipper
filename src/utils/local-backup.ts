// "Export all settings" used to cover only what lives in storage.sync (templates, providers, models, keys). Everything the
// extension keeps in storage.local (chat history, highlights, learning drafts, study choices) was lost whenever the extension
// was reinstalled under a different ID. This picks that user content up into the same export file, and puts it back on import.
// It is an allow-list: caches, device ids and half-finished jobs are deliberately left out.

export const LOCAL_BACKUP_KEY = '__qiaomuLocalData';

const EXACT = new Set([
	'highlights', 'history', 'domains',
	'qiaomuChatIndex', 'qiaomuChatPreferences', 'qiaomuChatModel', 'qiaomuChatWidth',
	'qiaomuAsrSettings', 'qiaomuAsrLanguage', 'qiaomuStudySites', 'qiaomuStudyRecent', 'qiaomuAudioRate',
	'qiaomuYouTubePlayerMode', 'qiaomuYouTubeFloat', 'qiaomuYouTubePlayerSize',
	'qiaomuTranscriptBarOpen', 'qiaomuTranscriptBarFollow', 'qiaomuRssEnabled', 'lastSelectedVault'
]);
// One entry per article chat, per learning-note draft (and its record), and per clip waiting to be submitted.
const PREFIXES = ['qiaomuChat:', 'qiaomuLearningDraft:', 'qiaomuPending:'];

export const isBackedUpKey = (key: string): boolean => EXACT.has(key) || PREFIXES.some(prefix => key.startsWith(prefix));

export interface LocalBackup { version: 1; exportedAt: string; items: Record<string, unknown> }

export function pickLocalBackup(all: Record<string, unknown>, now = new Date()): LocalBackup {
	const items: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(all)) if (isBackedUpKey(key) && value !== undefined) items[key] = value;
	return { version: 1, exportedAt: now.toISOString(), items };
}

// Splits an imported file into the part for storage.sync and the part for storage.local. The file is not trusted to name
// arbitrary keys: only allow-listed ones come back.
export function splitImport(file: Record<string, unknown>): { sync: Record<string, unknown>; local: Record<string, unknown> } {
	const { [LOCAL_BACKUP_KEY]: backup, ...sync } = file;
	const local: Record<string, unknown> = {};
	const items = (backup as Partial<LocalBackup> | undefined)?.items;
	if (items && typeof items === 'object') for (const [key, value] of Object.entries(items)) if (isBackedUpKey(key)) local[key] = value;
	return { sync, local };
}

export async function restoreLocalBackup(store: { set(items: Record<string, unknown>): Promise<void> }, local: Record<string, unknown>): Promise<number> {
	const count = Object.keys(local).length;
	if (count) await store.set(local);
	return count;
}
