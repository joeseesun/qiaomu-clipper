import type { RemotePreviewMedia } from './remote-preview-media';
import browser from './browser-polyfill';
import { LocalSavePayload, saveLocalClip } from './local-save';
import { QiaomuClip, QiaomuResult } from './qiaomu-rss';
import { saveToObsidian } from './obsidian-note-creator';
import { Property } from '../types/types';
import { incrementStat, loadSettings, setLocalStorage } from './storage-utils';

import { t } from './ui-text';
import type { LocalPreviewMedia } from './local-preview-media';
export interface ClipPreview {
    local: LocalSavePayload;
    clip: QiaomuClip;
    aggregate: boolean;
    native: boolean;
    properties?: Property[];
    createdAt?: number;
    transcriptExport?: { source: string; previous: string; mode?: 'original' | 'translated' | 'bilingual' };
    readerAppendix?: string;
    localMedia?: LocalPreviewMedia;
    remoteMedia?: RemotePreviewMedia;
    studyEditedAt?: number;
    studySource?: string;
    mediaReadUrl?: string;
    localDone?: boolean;
    rssDone?: boolean;
}
const prefix = 'qiaomuPreview:';
const snapshots = new WeakMap<ClipPreview, string>();
const textSnapshot = (draft: ClipPreview) => JSON.stringify([draft.clip, draft.local, draft.properties, draft.readerAppendix, draft.transcriptExport, draft.studyEditedAt]);
const remember = (draft: ClipPreview) => { snapshots.set(draft, textSnapshot(draft)); return draft; };
// Extension pages share an origin: Web Locks serialize the read/check/write across tabs.
// The in-process queue is also used by non-DOM test/CLI consumers.
const writes = new Map<string, Promise<unknown>>();
async function withDraftLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(prefix + id, work);
    const prior = writes.get(id) || Promise.resolve();
    const next = prior.catch(() => {}).then(work); writes.set(id, next);
    try { return await next; } finally { if (writes.get(id) === next) writes.delete(id); }
}
export function adoptClipPreview(draft: ClipPreview, latest: ClipPreview): void { Object.assign(draft, latest); remember(draft); }
export async function refreshClipPreview(draft: ClipPreview): Promise<void> {
    const latest = await loadClipPreview(draft.local.requestId);
    if (latest) adoptClipPreview(draft, latest);
}
export type ClipPreviewPatch = Pick<Partial<ClipPreview>, 'localMedia' | 'remoteMedia' | 'studySource' | 'localDone' | 'rssDone' | 'aggregate'>;
export async function patchClipPreview(draft: ClipPreview, patch: ClipPreviewPatch): Promise<void> {
    await withDraftLock(draft.local.requestId, async () => {
        const key = prefix + draft.local.requestId;
        const latest = (await browser.storage.local.get(key))[key] as ClipPreview | undefined;
        await browser.storage.local.set({ [key]: { ...(latest || draft), ...patch } });
    });
}
export const isStudyPreview = (draft: ClipPreview) => Boolean(draft.studySource || draft.mediaReadUrl || draft.remoteMedia || draft.localMedia);
const hasStudyEdits = (draft: ClipPreview) => (Number.isFinite(draft?.studyEditedAt) && draft.studyEditedAt! > 0) || Boolean(draft?.remoteMedia && draft.clip?.markdown && !draft.transcriptExport);
const editTime = (draft: ClipPreview) => draft.studyEditedAt || draft.createdAt || 0;
// Recognition cache is immutable source text; edited study drafts are separate.
export async function loadEditedStudyPreview(url: string): Promise<ClipPreview | null> {
    const saved = await browser.storage.local.get(null);
    const drafts = Object.entries(saved).filter(([key, value]) => key.startsWith(prefix) && hasStudyEdits(value as ClipPreview)).map(([, value]) => value as ClipPreview);
    const found = drafts.filter(draft => draft.clip?.url === url || draft.studySource === url).sort((a, b) => editTime(b) - editTime(a))[0];
    return found ? remember(found) : null;
}
export async function openClipPreview(draft: ClipPreview, page = 'reader.html?preview=') {
    const saved = await browser.storage.local.get(null);
    const expired = Object.keys(saved).filter(key => key.startsWith(prefix) && !hasStudyEdits(saved[key] as ClipPreview) && Date.now() - (saved[key] as ClipPreview).createdAt! > 86400000);
    for (const key of expired) await withDraftLock(key.slice(prefix.length), async () => {
        const latest = (await browser.storage.local.get(key))[key] as ClipPreview | undefined;
        if (latest && !hasStudyEdits(latest) && Date.now() - latest.createdAt! > 86400000) await browser.storage.local.remove([key]);
    });
    await browser.storage.local.set({ [prefix + draft.local.requestId]: { ...draft, createdAt: Date.now() } });
    await browser.tabs.create({ url: browser.runtime.getURL(`${page}${draft.local.requestId}`) });
}
export async function updateClipPreview(draft: ClipPreview, expected?: ClipPreview) {
    await withDraftLock(draft.local.requestId, async () => {
        const key = prefix + draft.local.requestId;
        const latest = (await browser.storage.local.get(key))[key] as ClipPreview | undefined;
        const baseline = snapshots.get(expected || draft) || (expected ? textSnapshot(expected) : undefined);
        if (latest && baseline !== undefined && textSnapshot(latest) !== baseline) {
            throw new Error(t('草稿已在另一个页面修改。请先复制或下载当前文字，再重新打开最新草稿。'));
        }
        await browser.storage.local.set({ [key]: { ...draft, ...(latest ? {localMedia:latest.localMedia,remoteMedia:latest.remoteMedia,aggregate:latest.aggregate} : {}), ...(latest?.localDone ? {localDone:true} : {}), ...(latest?.rssDone ? {rssDone:true} : {}) } });
        remember(draft);
        if (expected) snapshots.set(expected, textSnapshot(draft));
    });
}
export async function loadClipPreview(id: string): Promise<ClipPreview | null> {
    const saved = await browser.storage.local.get(prefix + id);
    const draft = saved[prefix + id] as ClipPreview | undefined;
    return draft && (hasStudyEdits(draft) || (draft.createdAt && Date.now() - draft.createdAt < 86400000)) ? remember(draft) : null;
}

// Persist each successful destination before retrying: an RSS failure must not create another note.
export async function saveClipPreview(draft: ClipPreview): Promise<string[]> {
    await refreshClipPreview(draft);
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
            await patchClipPreview(draft, {...(draft.localDone ? {localDone:true} : {}), ...(draft.rssDone ? {rssDone:true} : {})});
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
    await patchClipPreview(draft, {...(draft.localDone ? {localDone:true} : {}), ...(draft.rssDone ? {rssDone:true} : {})});
    return status;
}
