import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { ClipPreview, saveClipPreview } from './clip-preview';
import { saveToObsidian } from './obsidian-note-creator';
vi.mock('./obsidian-note-creator', () => ({ saveToObsidian: vi.fn() }));
vi.mock('./storage-utils', () => ({ loadSettings: vi.fn(), incrementStat: vi.fn(), setLocalStorage: vi.fn() }));
const draft = (): ClipPreview => ({ createdAt: Date.now(), local: { requestId: 'stable-id', content: '---\ntitle: 修改后的标题\n---\n仅选中的 **文字**', name: '修改后的标题.md', folder: 'Resources/Clippings', vault: 'daily-vault', behavior: 'create' }, clip: { url: 'https://example.com/article', title: '修改后的标题', markdown: '仅选中的 **文字**' }, native: true, aggregate: true });
beforeEach(() => vi.restoreAllMocks());
describe('preview clipping destinations', () => {
    it('saves the edited selection and chosen target without fetching the article again', async () => {
        const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async (message: any) => message.action === 'qiaomuLocalSave' ? { ok: true, vault: 'daily-vault', relativePath: 'Resources/Clippings/title.md' } : { accepted: true });
        const clip = draft();
        await saveClipPreview(clip);
        expect(send).toHaveBeenCalledWith({ action: 'qiaomuLocalSave', payload: clip.local });
        expect(send).toHaveBeenCalledWith({ action: 'qiaomuSubmitClip', clip: clip.clip });
        expect(clip.localDone && clip.rssDone).toBe(true);
    });
    it('retries only RSS after a partial failure, keeping the same native request id', async () => {
        let accepted = false;
        const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async (message: any) => message.action === 'qiaomuLocalSave' ? { ok: true } : { accepted, error: 'offline' });
        const clip = draft();
        expect((await saveClipPreview(clip)).join(' ')).toContain('offline');
        accepted = true;
        await saveClipPreview(clip);
        expect(send.mock.calls.filter(([message]: any[]) => message.action === 'qiaomuLocalSave')).toHaveLength(1);
        await saveClipPreview(clip);
        expect(send).toHaveBeenCalledTimes(3);
    });
    it('keeps a failed local request retryable when RSS already succeeded', async () => {
        let ok = false;
        const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async (message: any) => message.action === 'qiaomuLocalSave' ? { ok, error: 'wrong vault' } : { accepted: true });
        const clip = draft();
        await saveClipPreview(clip);
        expect(clip.localDone).toBeUndefined();
        expect(clip.rssDone).toBe(true);
        ok = true;
        await saveClipPreview(clip);
        expect(send.mock.calls.filter(([message]: any[]) => message.action === 'qiaomuSubmitClip')).toHaveLength(1);
        expect(send.mock.calls.filter(([message]: any[]) => message.action === 'qiaomuLocalSave').map(([message]: any[]) => message.payload.requestId)).toEqual(['stable-id', 'stable-id']);
    });
    it('does not submit when RSS is disabled and uses the existing URI fallback without a helper', async () => {
        const send = vi.spyOn(browser.runtime, 'sendMessage');
        const clip = { ...draft(), native: false, aggregate: false };
        const result = await saveClipPreview(clip);
        expect(send).not.toHaveBeenCalled();
        expect(saveToObsidian).toHaveBeenCalledWith(clip.local.content, '修改后的标题', clip.local.folder, clip.local.vault, 'create');
        expect(result).toEqual(['已发送到 Obsidian']);
    });
});
