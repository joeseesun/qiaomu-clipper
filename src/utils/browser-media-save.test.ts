import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const api = vi.hoisted(() => ({ download:vi.fn(), search:vi.fn(), show:vi.fn(), cancel:vi.fn(), onChanged:{addListener:vi.fn(),removeListener:vi.fn()} }));
vi.mock('./browser-polyfill',()=>({default:{downloads:api}}));
import { saveDownloadedBlob } from './browser-media-save';
const flush = async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
beforeEach(()=>{vi.resetAllMocks(); api.download.mockResolvedValue(7); api.search.mockResolvedValue([{state:'in_progress'}]); api.cancel.mockResolvedValue(undefined); vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
it('waits for the real download completion before success and frees the object URL',async()=>{
 let done=false;const save=saveDownloadedBlob(new Blob(['video']),'clip.mp4').then(x=>{done=true;return x;});await flush();expect(done).toBe(false);
 const listener=api.onChanged.addListener.mock.calls[0][0];listener({id:8,state:{current:'complete'}});await flush();expect(done).toBe(false);
 listener({id:7,state:{current:'complete'}});const result=await save;expect(done).toBe(true);result.reveal();expect(api.show).toHaveBeenCalledWith(7);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');expect(api.onChanged.removeListener).toHaveBeenCalledWith(listener);
});
it('handles a file which completed before listener registration',async()=>{api.search.mockResolvedValue([{state:'complete'}]);await expect(saveDownloadedBlob(new Blob(['v']),'x.mp4')).resolves.toHaveProperty('reveal');});
it('reports interrupted saves instead of success',async()=>{api.search.mockResolvedValue([{state:'interrupted'}]);await expect(saveDownloadedBlob(new Blob(['v']),'x.mp4')).rejects.toMatchObject({code:'network'});expect(URL.revokeObjectURL).toHaveBeenCalled();});
it('cancels saving and releases resources',async()=>{const controller=new AbortController();const result=saveDownloadedBlob(new Blob(['v']),'x.mp4',controller.signal);await flush();controller.abort();await expect(result).rejects.toMatchObject({code:'cancelled'});expect(api.cancel).toHaveBeenCalledWith(7);expect(api.onChanged.removeListener).toHaveBeenCalled();});
it('releases the blob on browser download rejection',async()=>{api.download.mockRejectedValue(new Error('denied'));await expect(saveDownloadedBlob(new Blob(['v']),'x.mp4')).rejects.toThrow('denied');expect(URL.revokeObjectURL).toHaveBeenCalled();});
