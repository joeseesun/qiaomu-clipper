import { describe, expect, it, vi } from 'vitest';
import { LOCAL_BACKUP_KEY, isBackedUpKey, pickLocalBackup, restoreLocalBackup, splitImport } from './local-backup';

describe('local data backup', () => {
	it('keeps the user content of storage.local and leaves caches, device ids and jobs out', () => {
		const backup = pickLocalBackup({
			highlights: { a: 1 }, history: [1], domains: {}, qiaomuChatIndex: [], qiaomuChatPreferences: { fontSize: 14 }, qiaomuChatModel: 'm1',
			'qiaomuChat:https://a.example': { conversations: [] }, 'qiaomuLearningDraft:https%3A%2F%2Fa': 'id1', 'qiaomuLearningDraft:https%3A%2F%2Fa:record:id1': { reflection: 'x' },
			'qiaomuPending:https://a.example': { title: 't' },
			qiaomuDeviceId: 'secret-device', qiaomuPendingAction: { x: 1 }, qiaomuNativeConfigured: true, provider_presets: { big: 1 },
			'qiaomuLearningUriAttempt:abc': 1, 'qiaomuLearningPending:abc': 1, 'qiaomuTranscript:abc': 'cached'
		}, new Date('2026-10-08T00:00:00Z'));
		expect(Object.keys(backup.items).sort()).toEqual(['highlights', 'history', 'domains', 'qiaomuChatIndex', 'qiaomuChatPreferences', 'qiaomuChatModel', 'qiaomuChat:https://a.example', 'qiaomuLearningDraft:https%3A%2F%2Fa', 'qiaomuLearningDraft:https%3A%2F%2Fa:record:id1', 'qiaomuPending:https://a.example'].sort());
		expect(backup.version).toBe(1);
		expect(backup.exportedAt).toBe('2026-10-08T00:00:00.000Z');
	});

	it('splits an imported file so the local part never reaches storage.sync', () => {
		const file = { general_settings: { x: 1 }, template_list: ['a'], [LOCAL_BACKUP_KEY]: { version: 1, items: { highlights: { a: 1 }, qiaomuChatModel: 'm1' } } };
		const { sync, local } = splitImport(file);
		expect(sync).toEqual({ general_settings: { x: 1 }, template_list: ['a'] });
		expect(local).toEqual({ highlights: { a: 1 }, qiaomuChatModel: 'm1' });
		expect(LOCAL_BACKUP_KEY in sync).toBe(false);
	});

	it('does not trust the file to name arbitrary storage keys', () => {
		const { local } = splitImport({ [LOCAL_BACKUP_KEY]: { items: { qiaomuDeviceId: 'x', qiaomuPendingAction: 1, anything: 2, highlights: {} } } });
		expect(local).toEqual({ highlights: {} });
		expect(isBackedUpKey('qiaomuChat:abc')).toBe(true);
		expect(isBackedUpKey('qiaomuChatX')).toBe(false);
	});

	it('imports an older file with no local part, writing nothing to storage.local', async () => {
		const set = vi.fn(async () => {});
		const { sync, local } = splitImport({ general_settings: {} });
		expect(sync).toEqual({ general_settings: {} });
		expect(await restoreLocalBackup({ set }, local)).toBe(0);
		expect(set).not.toHaveBeenCalled();
	});

	it('writes the allowed items back and reports how many', async () => {
		const set = vi.fn(async () => {});
		const { local } = splitImport({ [LOCAL_BACKUP_KEY]: { items: { highlights: { a: 1 }, history: [] } } });
		expect(await restoreLocalBackup({ set }, local)).toBe(2);
		expect(set).toHaveBeenCalledWith({ highlights: { a: 1 }, history: [] });
	});
});
