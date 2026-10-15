// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const api=vi.hoisted(()=>({request:vi.fn(),download:vi.fn(),search:vi.fn(),getManifest:vi.fn(),helper:vi.fn()}));
vi.mock('./browser-polyfill',()=>({default:{ runtime:{getManifest:api.getManifest},permissions:{request:api.request},storage:{local:{get:async()=>({}),set:async()=>{}}},downloads:{download:api.download,search:api.search,onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}}}));
vi.mock('./study-download-native',()=>({downloadWithHelper:api.helper}));
import { DownloadError } from './media-download';
import {mountStudyDownload} from './study-download';
const source='https://x.com/author/status/1',media='https://video.twimg.com/test.mp4';
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
async function mount(over:Partial<Parameters<typeof mountStudyDownload>[2]>={}) {
 document.body.innerHTML='<article><div class="player-container"><video></video><div class="player-toggles"></div></div></article>';
 const article=document.querySelector('article')!,player=document.querySelector('video')!;
 await mountStudyDownload(article,player,{title:'Test',sourceUrl:source,mediaUrl:media,video:true,...over});return article;
}
beforeEach(()=>{vi.resetAllMocks();api.getManifest.mockReturnValue({optional_permissions:['downloads']});api.request.mockResolvedValue(true);api.download.mockResolvedValue(1);api.search.mockResolvedValue([{state:'complete'}]);vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([0,1,2]),{headers:{'content-type':'video/mp4'}})));vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();vi.restoreAllMocks();});
it('mounts a real player control and saves a non-YouTube file with optional permission',async()=>{
 const article=await mount();expect(article.querySelector('.qiaomu-dl-main')).not.toBeNull();article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();
 if(!__LOCAL_EDITION__) expect(api.request).toHaveBeenCalledWith({permissions:['downloads']});
 await flush();expect(fetch).toHaveBeenCalledWith(media,expect.objectContaining({redirect:__LOCAL_EDITION__?'follow':'error'}));expect(api.download).toHaveBeenCalled();expect(article.querySelector('.qiaomu-dl')?.getAttribute('data-state')).toBe('done');
});
it.skipIf(__LOCAL_EDITION__)('does not offer or request YouTube downloads',async()=>{for(const over of [{sourceUrl:'https://youtu.be/1'},{mediaUrl:'https://r1.googlevideo.com/videoplayback'}]){const article=await mount(over);expect(article.querySelector('.qiaomu-dl')).toBeNull();}expect(api.request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
it.skipIf(__LOCAL_EDITION__)('does not fetch when permission is denied',async()=>{api.request.mockResolvedValue(false);const article=await mount();article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(fetch).not.toHaveBeenCalled();expect(api.download).not.toHaveBeenCalled();expect(article.textContent).toContain('未获得下载权限');});
it('exports split streams and playlists through the helper without starting ASR',async()=>{api.helper.mockResolvedValue({reveal:vi.fn()});for(const over of [{split:true},{mediaUrl:'https://cdn.example.org/master.m3u8'},{mediaUrl:'https://cdn.example.org/manifest.mpd'}]){const article=await mount(over);article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(article.querySelector('.qiaomu-dl')?.getAttribute('data-state')).toBe('done');}expect(api.helper).toHaveBeenCalledTimes(3);expect(api.request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
it('offers Bilibili downloads before an iframe or transcript has loaded, follows rebuilt controls, and avoids duplicates',async()=>{
 document.body.innerHTML='<article></article>';const article=document.querySelector('article')!;
 const options={title:'Bili',sourceUrl:'https://www.bilibili.com/video/BV1xx411c7mD/',mediaUrl:'',video:true};
 await mountStudyDownload(article,undefined,options);expect(article.querySelector('.qiaomu-dl-main')).not.toBeNull();
 article.insertAdjacentHTML('beforeend','<div class="player-container"><iframe></iframe><div class="player-toggles"></div></div>');await flush();
 expect(article.querySelector('.player-toggles .qiaomu-dl-main')).not.toBeNull();await mountStudyDownload(article,undefined,options);expect(article.querySelectorAll('.qiaomu-dl')).toHaveLength(1);
 article.querySelector('.player-toggles')!.remove();await flush();expect(article.querySelector('.player-container .qiaomu-dl-main')).not.toBeNull();
});
it('places podcast downloads outside the crowded playback speed row, with no transcript needed',async()=>{
 document.body.innerHTML='<article><div class="qiaomu-audio-hero">Podcast cover</div><div class="reader-video-wrapper is-audio"><video></video><div class="qa-tools"></div></div></article>';const article=document.querySelector('article')!;
 await mountStudyDownload(article,article.querySelector('video')!,{title:'Podcast',sourceUrl:'https://www.xiaoyuzhoufm.com/episode/65abcdef0123456789abcdef',mediaUrl:'https://media.xyzcdn.net/podcast.m4a',video:false});
 expect(article.querySelector('.qiaomu-dl-main')).not.toBeNull();expect(article.querySelector('.qa-tools .qiaomu-dl')).toBeNull();
 expect(article.querySelector('.reader-video-wrapper')!.nextElementSibling?.className).toBe('qiaomu-dl-host');
});
it('keeps downloads beside the video controls while the transcript is still loading',async()=>{
 document.body.innerHTML='<article><iframe class="youtube-sized-player"></iframe><div class="youtube-player-resize"></div><div class="youtube-mode-bar"></div><div class="youtube-float-chrome"></div></article>';const article=document.querySelector('article')!;
 await mountStudyDownload(article,undefined,{title:'Bili',sourceUrl:'https://www.bilibili.com/video/BV1GJ411x7h7/',mediaUrl:'',video:true});
 const host=article.querySelector<HTMLElement>('.qiaomu-dl-host')!;
 expect(host.previousElementSibling?.className).toBe('youtube-mode-bar');expect(host.style.display).toBe('inline-flex');expect(article.querySelector('.qiaomu-dl-note')).toBeNull();
});
it('falls back to native on CDN fetch failure and keeps an actionable error when the helper is absent',async()=>{
 vi.mocked(fetch).mockRejectedValue(new TypeError('CORS'));api.helper.mockRejectedValue(new DownloadError('helper','没连上本地助手'));
 const article=await mount();article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(api.helper).toHaveBeenCalledOnce();expect(article.textContent).toContain('没连上本地助手');expect(article.textContent).toContain('设置');expect(api.download).not.toHaveBeenCalled();
});
it('does not offer downloads on builds without the declared API permission',async()=>{api.getManifest.mockReturnValue({permissions:[]});expect((await mount()).querySelector('.qiaomu-dl')).toBeNull();});
it('checks encrypted media again at click time',async()=>{const article=await mount();Object.defineProperty(article.querySelector('video'),'mediaKeys',{value:{}});article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(fetch).not.toHaveBeenCalled();expect(api.download).not.toHaveBeenCalled();});
