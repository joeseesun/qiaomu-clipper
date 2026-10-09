// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ put: vi.fn(), take: vi.fn(), release: vi.fn(), update: vi.fn() }));
vi.mock('./file-handoff', () => ({ putHandedFile: state.put, takeHandedFile: state.take, releaseHandedFile: state.release }));
vi.mock('./clip-preview', () => ({ updateClipPreview: state.update }));
import { bindLocalPreviewMedia, preserveLocalPreviewMedia, mountLocalPreviewMedia, prepareLocalPreviewTranscript } from './local-preview-media';
import type { ClipPreview } from './clip-preview';
const file = () => new File(['synthetic video'], 'lesson.mp4', { type: 'video/mp4', lastModified: 123 });
const draft = () => ({ local: { requestId: 'one' }, clip: { markdown: '**0:05** · Edited', title: 'Lesson' } }) as ClipPreview;
const TOKEN = 'a'.repeat(24);
beforeEach(() => {
 vi.clearAllMocks(); state.put.mockResolvedValue(TOKEN); state.take.mockResolvedValue(file()); state.update.mockResolvedValue(undefined);
 document.body.innerHTML = '<article><div id="anchor"></div></article>';
 vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one-page'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
 vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); });
it('waits for the File transaction before persisting a token and playback metadata, with no URL or bytes in the text draft', async () => {
 const data = draft(), player = document.createElement('video'); player.currentTime = 5; player.playbackRate = 1.5; player.volume = .4; player.muted = true;
 bindLocalPreviewMedia(data, file(), player); await preserveLocalPreviewMedia(data);
 expect(data.localMedia).toEqual({ token: TOKEN, name:'lesson.mp4', size:15, modified:123, time:5, rate:1.5, volume:.4, muted:true });
 expect(state.update).toHaveBeenCalledWith(data); expect(JSON.stringify(data)).not.toMatch(/blob:|synthetic video/);
 await preserveLocalPreviewMedia(data); expect(state.put).toHaveBeenCalledTimes(1);
});
it('does not leave the playable page if IndexedDB could not commit a handoff', async () => {
 state.put.mockResolvedValue(undefined); const data = draft(); bindLocalPreviewMedia(data, file(), document.createElement('video'));
 await expect(preserveLocalPreviewMedia(data)).rejects.toThrow('无法保留'); expect(state.update).not.toHaveBeenCalled(); expect(data.localMedia).toBeUndefined();
});
it('rolls back draft metadata and the new token if draft storage fails', async () => {
 const data = draft(); state.update.mockRejectedValue(new Error('storage full')); bindLocalPreviewMedia(data, file(), document.createElement('video'));
 await expect(preserveLocalPreviewMedia(data)).rejects.toThrow('storage full'); expect(data.localMedia).toBeUndefined(); expect(state.release).toHaveBeenCalledWith(TOKEN);
});
it('creates a fresh playable URL on the next page and restores seek, rate, volume and mute after metadata', async () => {
 const data = draft(); data.localMedia = {token:TOKEN,name:'lesson.mp4',size:15,modified:123,time:5,rate:1.5,volume:.4,muted:true};
 await mountLocalPreviewMedia(data, document.querySelector('article')!, document.getElementById('anchor')!);
 const player = document.querySelector('video')!; player.dispatchEvent(new Event('loadedmetadata'));
 expect(player.src).toBe('blob:one-page'); expect(player.currentTime).toBe(5); expect(player.playbackRate).toBe(1.5); expect(player.volume).toBe(.4); expect(player.muted).toBe(true); expect(player.controls).toBe(true);
 window.dispatchEvent(new Event('pagehide')); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one-page');
});
it('offers reselect for expired media, rejects a different file, and restores the same file without recognition', async () => {
 state.take.mockResolvedValue(undefined); const data = draft(); data.localMedia = {token:TOKEN,name:'lesson.mp4',size:15,modified:123,time:5,rate:1,volume:1,muted:false}; const ready = vi.fn();
 await mountLocalPreviewMedia(data, document.querySelector('article')!, document.getElementById('anchor')!, ready);
 expect(document.querySelector('video')).toBeNull(); const input = document.querySelector('input')!;
 Object.defineProperty(input, 'files', {value:[new File(['wrong'], 'other.mp4')], configurable:true}); input.dispatchEvent(new Event('change')); await Promise.resolve();
 expect(document.querySelector('.local-preview-reselect')?.textContent).toContain('同一文件'); expect(ready).not.toHaveBeenCalled();
 Object.defineProperty(input, 'files', {value:[file()], configurable:true}); input.dispatchEvent(new Event('change')); for (let i=0;i<8;i++) await Promise.resolve();
 expect(document.querySelector('video')).not.toBeNull(); expect(document.querySelector('.local-preview-reselect')).toBeNull(); expect(ready).toHaveBeenCalledTimes(1);
});
it('binds the edited timestamp paragraphs without restoring old text or converting ordinary bold prose', () => {
 const article = document.querySelector('article')!; article.innerHTML='<p><strong>Notes</strong> keep</p><p><strong>[1:02:03]</strong> · Edited text</p><p><strong>0:05</strong> · Another</p>';
 const transcript = prepareLocalPreviewTranscript(article)!;
 expect(transcript.querySelectorAll('.transcript-segment')).toHaveLength(2); expect(transcript.querySelector('strong')?.dataset.timestamp).toBe('3723'); expect(transcript.textContent).toContain('Edited text'); expect(article.firstElementChild?.textContent).toBe('Notes keep');
});
it('leaves ordinary clips untouched', async () => {
 const data = draft(); await preserveLocalPreviewMedia(data); await mountLocalPreviewMedia(data, document.querySelector('article')!, document.getElementById('anchor')!);
 expect(state.put).not.toHaveBeenCalled(); expect(state.take).not.toHaveBeenCalled(); expect(document.querySelector('video')).toBeNull();
});
