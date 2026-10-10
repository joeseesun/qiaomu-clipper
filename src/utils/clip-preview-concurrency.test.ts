import { beforeEach, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import * as previews from './clip-preview';
import type { ClipPreview } from './clip-preview';
let saved: Record<string, any>;
const draft = (): ClipPreview => ({createdAt: Date.now(), studySource: 'https://example.com/lesson', clip:{url:'https://example.com/lesson',title:'Lesson',markdown:'Original'},local:{requestId:'shared',name:'Lesson.md',content:'Original',folder:'Clips',vault:'Daily',behavior:'create'},native:true,aggregate:false});
beforeEach(() => {
 saved = {'qiaomuPreview:shared': draft()};
 vi.spyOn(browser.storage.local,'get').mockImplementation(async key => structuredClone(key === null ? saved : {[String(key)]:saved[String(key)]}));
 vi.spyOn(browser.storage.local,'set').mockImplementation(async values => {Object.assign(saved, structuredClone(values));});
});
it('old-tab playback writes preserve newer recovered text, title, properties and delivery flags', async () => {
 const old = await previews.loadClipPreview('shared');
 const newer = await previews.loadClipPreview('shared');
 newer!.clip.markdown = 'Recovered edits'; newer!.clip.title = 'Edited title'; newer!.local.content = 'Recovered edits'; newer!.properties=[{name:'title',value:'Edited title',type:'text'}];
 await previews.updateClipPreview(newer!);
 // A field update is the contract required by player preservation, recovery and save receipts.
 await (previews as any).patchClipPreview(old!, {remoteMedia:{token:'fixture',time:5,rate:1,volume:1,muted:false}});
 expect(saved['qiaomuPreview:shared'].clip).toMatchObject({markdown:'Recovered edits',title:'Edited title'});
 expect(saved['qiaomuPreview:shared'].properties).toEqual(newer!.properties);
});
it('rejects competing old-tab text edits without losing either stored text or local pending edits', async () => {
 const a=await previews.loadClipPreview('shared'), b=await previews.loadClipPreview('shared');
 b!.clip.markdown='B edits';await previews.updateClipPreview(b!);
 a!.clip.markdown='A pending';await expect(previews.updateClipPreview(a!)).rejects.toThrow();
 expect(saved['qiaomuPreview:shared'].clip.markdown).toBe('B edits'); expect(a!.clip.markdown).toBe('A pending');
});
it('preserves an edited caption-only study beyond preview cleanup and finds it by the original source', async () => {
 const item=draft();item.createdAt=Date.now()-3*86400000;item.studyEditedAt=Date.now();item.clip.markdown='Edited captions without HLS';
 saved['qiaomuPreview:shared']=item;
 expect((await previews.loadEditedStudyPreview(item.studySource!))?.clip.markdown).toBe(item.clip.markdown);
 const remove=vi.fn();Object.assign(browser.storage.local,{remove});Object.assign(browser.tabs,{create:vi.fn().mockResolvedValue({})});
 await previews.openClipPreview({...draft(),local:{...draft().local,requestId:'new'}});expect(remove).not.toHaveBeenCalled();
});
