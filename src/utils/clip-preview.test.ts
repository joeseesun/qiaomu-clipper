import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { ClipPreview, saveClipPreview, loadClipPreview, loadEditedStudyPreview, openClipPreview } from './clip-preview';
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

it('retains edited study drafts after temporary expiry, matching only the source and newest edit', async()=>{
 const old={...draft(),createdAt:Date.now()-3*86400000,studyEditedAt:Date.now()-100,studySource:'https://shop.xet.tech/s/Fixture123'};
 const fresh={...old,studyEditedAt:Date.now(),local:{...old.local,requestId:'newest'},clip:{...old.clip,markdown:'Newest edits'}};
 const raw={...old,studyEditedAt:undefined,local:{...old.local,requestId:'raw'}};
 const saved={'qiaomuPreview:stable-id':old,'qiaomuPreview:newest':fresh,'qiaomuPreview:raw':raw};
 vi.spyOn(browser.storage.local,'get').mockImplementation(async key=>key===null?saved:{[String(key)]:saved[String(key) as keyof typeof saved]});
 const remove=vi.fn().mockResolvedValue(undefined);Object.assign(browser.storage.local,{remove});Object.assign(browser.tabs,{create:vi.fn().mockResolvedValue({})});
 expect(await loadClipPreview('stable-id')).toBe(old);expect(await loadClipPreview('raw')).toBeNull();
 expect(await loadEditedStudyPreview(old.studySource)).toBe(fresh);expect(await loadEditedStudyPreview('https://example.com/unrelated')).toBeNull();
 await openClipPreview(draft());expect(remove).toHaveBeenCalledWith(['qiaomuPreview:raw']);
});

it('recovers legacy mode-switch drafts whose transcript was already manually edited',async()=>{
 const legacy={...draft(),createdAt:Date.now()-2*86400000,remoteMedia:{token:'fixture',time:4,rate:1,volume:1,muted:false}};
 vi.spyOn(browser.storage.local,'get').mockResolvedValue({'qiaomuPreview:stable-id':legacy});
 expect(await loadClipPreview('stable-id')).toBe(legacy);expect(await loadEditedStudyPreview(legacy.clip.url)).toBe(legacy);
});
