import {expect,it,vi} from 'vitest';
import {fetchXiaoePlaylist} from './xiaoe';
it('bounds bytes consumed from streamed playlists and cancels the reader on overflow',async()=>{
 const cancel=vi.fn(),encoder=new TextEncoder();const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('#EXTM3U\n'));c.enqueue(encoder.encode('too large'));},cancel});
 const get=vi.fn(async()=>new Response(stream));await expect(fetchXiaoePlaylist('https://video.xet.tech/a.m3u8',get,10)).rejects.toThrow('too large');expect(cancel).toHaveBeenCalled();expect(get).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({credentials:'omit',redirect:'error'}));
});
it('enforces a deadline while an already-open body stalls',async()=>{
 const cancel=vi.fn();const get=vi.fn(async()=>new Response(new ReadableStream({cancel})));
 await expect(fetchXiaoePlaylist('https://video.xet.tech/a.m3u8',get,100,10)).rejects.toThrow('timed out');expect(cancel).toHaveBeenCalled();
});
it('reads a complete finished playlist',async()=>{
 const text='#EXTM3U\n#EXTINF:4\na.ts\n#EXT-X-ENDLIST\n';expect(await fetchXiaoePlaylist('https://video.xet.tech/a.m3u8',async()=>new Response(text))).toBe(text);
});
