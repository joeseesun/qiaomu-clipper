// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ update: vi.fn(), open: vi.fn() }));
vi.mock('./clip-preview', () => ({ patchClipPreview: state.update }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => 'chrome-extension://fixture/' + p }, tabs: { create: state.open }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } } }));
import { bindRemotePreviewMedia, preserveRemotePreviewMedia, mountRemotePreviewMedia } from './remote-preview-media';
import type { ClipPreview } from './clip-preview';
const source = 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=private-fixture';
const draft = () => ({ local: { requestId: 'fixture' }, clip: { url: 'https://weixin.qq.com/sph/Fixture123', markdown: 'Edited transcript', title: 'Fixture' } }) as ClipPreview;
beforeEach(() => { vi.clearAllMocks(); state.update.mockResolvedValue(undefined); state.open.mockResolvedValue({id:7}); sessionStorage.clear(); document.body.innerHTML = '<article><div id="anchor"></div></article>'; vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); });
const preserve = async (data: ClipPreview) => {
 const player = document.createElement('video'); player.currentTime = 4; player.playbackRate = 1.5; player.volume = .4; player.muted = true;
 bindRemotePreviewMedia(data, player, source, true); await preserveRemotePreviewMedia(data); return player;
};
it('puts only a random token and playback state in the durable text draft', async () => {
 const data = draft(); await preserve(data);
 expect(data.remoteMedia).toMatchObject({time:4,rate:1.5,volume:.4,muted:true}); expect(JSON.stringify(data)).not.toContain('private-fixture');
 expect(sessionStorage.getItem('qiaomuPreviewMedia:'+data.remoteMedia!.token)).toContain(source); expect(state.update).toHaveBeenCalledWith(data, { remoteMedia: data.remoteMedia });
});
it('restores the same video across document navigation with seek and sound settings', async () => {
 const data=draft();await preserve(data); const restored=JSON.parse(JSON.stringify(data)),ready=vi.fn();
 await mountRemotePreviewMedia(restored,document.querySelector('article')!,document.getElementById('anchor')!,ready);
 const player=document.querySelector('video')!;player.dispatchEvent(new Event('loadedmetadata'));
 expect(player.src).toBe(source);expect(player.currentTime).toBe(4);expect(player.playbackRate).toBe(1.5);expect(player.volume).toBe(.4);expect(player.muted).toBe(true);expect(ready).toHaveBeenCalledTimes(1);
 player.currentTime=7;await preserveRemotePreviewMedia(restored);expect(restored.remoteMedia.time).toBe(7);expect(restored.clip.markdown).toBe('Edited transcript');
});
it('keeps edits and offers an explicit stable source link when the temporary session expires', async () => {
 const data=draft();await preserve(data);sessionStorage.clear();
 await mountRemotePreviewMedia(data,document.querySelector('article')!,document.getElementById('anchor')!);
 expect(document.querySelector('video')).toBeNull();expect(document.querySelector('.local-preview-reselect')?.textContent).toContain('字幕和编辑内容保留');
 const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('a')!.dispatchEvent(click);
 await vi.waitFor(() => expect(state.open).toHaveBeenCalled()); expect(click.defaultPrevented).toBe(true);expect(state.open).toHaveBeenCalledWith({url:'chrome-extension://fixture/reader.html?study=web&url='+encodeURIComponent(data.clip.url)+'&resume=fixture'});expect(data.clip.markdown).toBe('Edited transcript');
});
it('blocks navigation when session storage cannot preserve the current player', async () => {
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});const data=draft();
 await expect(preserve(data)).rejects.toThrow('无法保留视频播放状态');expect(data.remoteMedia).toBeUndefined();expect(state.update).not.toHaveBeenCalled();
});
it('rolls back the temporary reference when the durable draft cannot be written', async () => {
 const data=draft();state.update.mockRejectedValue(Error('quota'));
 await expect(preserve(data)).rejects.toThrow('字幕不会丢失');expect(data.remoteMedia).toBeUndefined();expect(sessionStorage.length).toBe(0);
});
it('preserves a separate audio track and displays a single recovery note on playback failure', async () => {
 const data=draft(),audio='https://v11.douyinvod.com/audio/fixture',player=document.createElement('video');
 bindRemotePreviewMedia(data,player,source,true,undefined,audio);await preserveRemotePreviewMedia(data);
 await mountRemotePreviewMedia(data,document.querySelector('article')!,document.getElementById('anchor')!);
 expect(document.querySelector('audio')?.src).toBe(audio);const restored=document.querySelector('video')!;restored.dispatchEvent(new Event('error'));restored.dispatchEvent(new Event('error'));
 expect(document.querySelectorAll('.local-preview-reselect')).toHaveLength(1);expect(document.querySelector('video')).toBe(restored);expect(data.clip.markdown).toBe('Edited transcript');
});
it('refuses credential-bearing or insecure playback addresses', async () => {
 for(const src of ['http://example.com/video','https://user:pass@example.com/video','javascript:alert(1)']){const data=draft();bindRemotePreviewMedia(data,document.createElement('video'),src,true);await preserveRemotePreviewMedia(data);expect(data.remoteMedia).toBeUndefined();}
 expect(state.update).not.toHaveBeenCalled();
});

it('saves pending edits before opening recovery and stops when persistence fails', async () => {
 const data=draft();await preserve(data);sessionStorage.clear();
 const save=vi.fn(async()=>{data.clip.markdown='New unsaved edits';});
 await mountRemotePreviewMedia(data,document.querySelector('article')!,document.getElementById('anchor')!,undefined,save);
 document.querySelector('a')!.click();await vi.waitFor(()=>expect(state.open).toHaveBeenCalledTimes(1));
 expect(save).toHaveBeenCalledTimes(1);expect(data.clip.markdown).toBe('New unsaved edits');
 state.open.mockClear();save.mockRejectedValueOnce(Error('full'));document.querySelector('a')!.click();
 await vi.waitFor(()=>expect(document.querySelector('.local-preview-reselect')?.textContent).toContain('编辑内容保存失败'));
 expect(state.open).not.toHaveBeenCalled();
});
