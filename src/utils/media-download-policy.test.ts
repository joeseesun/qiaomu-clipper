import { describe, it, expect, vi } from 'vitest';
import { canDownloadMedia } from './media-download-policy';
import { fetchMediaBlob } from './media-download';
const source = 'https://example.org/watch/1', media = 'https://cdn.example.org/video.mp4';
describe('media download edition policy', () => {
 it.each(['https://youtube.com/watch?v=x','https://m.youtube.com/shorts/x','https://youtu.be/x','https://www.youtube-nocookie.com/embed/x','https://music.youtube.com/watch?v=x','https://YouTube.com./watch?v=x'])('blocks original YouTube page %s, even with unrelated media CDN', url => {
  expect(canDownloadMedia(url, media, false)).toBe(false);
  expect(canDownloadMedia(url, media, true)).toBe(true);
 });
 it.each(['https://r1.googlevideo.com/videoplayback?x=1','https://googlevideo.com/video','https://youtube.com/video','https://youtube.googleapis.com/v/x'])('blocks embedded YouTube media on another website: %s', url => { expect(canDownloadMedia(source, url, false)).toBe(false); });
 it.each(['','bad','file:///tmp/source','http://example.org','https://user:pass@example.org'])('fails closed for missing or invalid source: %s', url => { expect(canDownloadMedia(url,media,false)).toBe(false); });
 it.each(['http://cdn.example.org/video.mp4','blob:https://example.org/1','https://user:pass@example.org/a.mp4','https://cdn.example.org/a.m3u8?q=1','https://cdn.example.org/a.mpd'])('rejects unsupported media: %s', url => { expect(canDownloadMedia(source,url,false)).toBe(false); });
 it('allows complete non-YouTube files without substring false positives', () => {
  expect(canDownloadMedia(source,media,false)).toBe(true);
  expect(canDownloadMedia('https://notyoutube.com', 'https://cdn.example.org/youtube.mp4',false)).toBe(true);
 });
});
// These execute with the actual store compile-time define in test:store-download.
describe.runIf(!__LOCAL_EDITION__)('store execution boundary', () => {
 it('rejects YouTube before any network request', async () => {
  const fetcher = vi.fn();
  await expect(fetchMediaBlob(media,{sourceUrl:'https://youtu.be/x',fetcher})).rejects.toMatchObject({code:'policy'});
  await expect(fetchMediaBlob('https://r1.googlevideo.com/videoplayback',{sourceUrl:source,fetcher})).rejects.toMatchObject({code:'policy'});
  await expect(fetchMediaBlob(media,{fetcher})).rejects.toMatchObject({code:'policy'});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('saves non-YouTube media while disabling redirect following', async () => {
  const fetcher = vi.fn(async () => new Response('video',{headers:{'content-type':'video/mp4'}}));
  const result=await fetchMediaBlob(media,{sourceUrl:source,fetcher});
  expect(result.size).toBe(5); expect(fetcher).toHaveBeenCalledWith(media,expect.objectContaining({redirect:'error'}));
 });
 it('rejects an unexpected redirected response without consuming it', async () => {
  const response = new Response('video',{headers:{'content-type':'video/mp4'}});
  Object.defineProperty(response,'url',{value:'https://r1.googlevideo.com/videoplayback'});
  const consume=vi.spyOn(response,'blob');
  await expect(fetchMediaBlob(media,{sourceUrl:source,fetcher:vi.fn(async()=>response)})).rejects.toMatchObject({code:'policy'});
  expect(consume).not.toHaveBeenCalled();
 });
 it('rejects stream manifests even at a file-looking URL', async () => {
  await expect(fetchMediaBlob(media,{sourceUrl:source,fetcher:vi.fn(async()=>new Response('#EXTM3U',{headers:{'content-type':'application/vnd.apple.mpegurl'}}))})).rejects.toMatchObject({code:'not-media'});
 });
});
