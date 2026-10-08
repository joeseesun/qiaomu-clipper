import browser from './browser-polyfill';
import { LocalSavePayload, saveLocalClip } from './local-save';
import { QiaomuClip, QiaomuResult } from './qiaomu-rss';
import { saveToObsidian } from './obsidian-note-creator';
import { Property } from '../types/types';
import { incrementStat, loadSettings, setLocalStorage } from './storage-utils';

import { t } from './ui-text';
export interface ClipPreview {
    local: LocalSavePayload;
    clip: QiaomuClip;
    mediaReadUrl?: string;
    aggregate: boolean;
    native: boolean;
    properties?: Property[];
    createdAt?: number;
    transcriptExport?: { source: string; previous: string; mode?: 'original' | 'translated' | 'bilingual' };
    readerAppendix?: string;
    localDone?: boolean;
    rssDone?: boolean;
}
const prefix = 'qiaomuPreview:';
export async function openClipPreview(draft: ClipPreview, page = 'reader.html?preview=') {
    const saved = await browser.storage.local.get(null);
    const expired = Object.keys(saved).filter(key => key.startsWith(prefix) && Date.now() - (saved[key] as ClipPreview).createdAt! > 86400000);
    if (expired.length) await browser.storage.local.remove(expired);
    await browser.storage.local.set({ [prefix + draft.local.requestId]: { ...draft, createdAt: Date.now() } });
    await browser.tabs.create({ url: browser.runtime.getURL(`${page}${draft.local.requestId}`) });
}
export async function updateClipPreview(draft: ClipPreview) {
    await browser.storage.local.set({ [prefix + draft.local.requestId]: draft });
}
export async function loadClipPreview(id: string): Promise<ClipPreview | null> {
    const saved = await browser.storage.local.get(prefix + id);
    const draft = saved[prefix + id] as ClipPreview | undefined;
    return draft && draft.createdAt && Date.now() - draft.createdAt < 86400000 ? draft : null;
}

// Persist each successful destination before retrying: an RSS failure must not create another note.
export async function saveClipPreview(draft: ClipPreview): Promise<string[]> {
    const status: string[] = [];
    if (!draft.localDone) {
        try {
            if (draft.native) {
                const result = await saveLocalClip(draft.local);
                if (!result.ok) throw new Error(result.error || t('本地保存失败，请重试'));
                status.push(t('已保存：{0} / {1}', [result.vault, result.relativePath]));
            } else {
                await loadSettings();
                await saveToObsidian(draft.local.content, draft.local.name.replace(/\.md$/, ''), draft.local.folder, draft.local.vault, draft.local.behavior);
                status.push(t('已发送到 Obsidian'));
            }
            draft.localDone = true;
            await browser.storage.local.set({ [prefix + draft.local.requestId]: draft });
            await setLocalStorage('lastSelectedVault', draft.local.vault);
            await incrementStat('addToObsidian', draft.local.vault, draft.local.folder, draft.clip.url, draft.clip.title);
        } catch (error) { status.push(String(error instanceof Error ? error.message : error)); }
    } else status.push(draft.native ? t('本地已保存') : t('已发送到 Obsidian'));
    if (draft.aggregate && !draft.rssDone) {
        try {
            const result = await browser.runtime.sendMessage({ action: 'qiaomuSubmitClip', clip: draft.clip }) as QiaomuResult;
            if (!result?.accepted) throw new Error(result?.error || t('RSS 提交失败，请重试'));
            draft.rssDone = true;
            status.push(t('RSS 已收录'));
        } catch (error) { status.push(String(error instanceof Error ? error.message : error)); }
    } else if (draft.aggregate) status.push(t('RSS 已收录'));
    await browser.storage.local.set({ [prefix + draft.local.requestId]: draft });
    return status;
}
