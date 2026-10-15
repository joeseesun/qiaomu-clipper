// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import I18nAutomation from './i18n-automation';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, {recursive:true,force:true})); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(target = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-i18n-')); roots.push(root);
 for (const locale of ['en','fr']) fs.mkdirSync(path.join(root, locale));
 const source = { save: { message: 'Save $name$', placeholders: {name:{content:'$1'}} } };
 fs.writeFileSync(path.join(root,'en/messages.json'),JSON.stringify(source));
 fs.writeFileSync(path.join(root,'fr/messages.json'),JSON.stringify(target));
 return { root, file:path.join(root,'fr/messages.json') };
}
it('fails instead of storing English as a completed translation when the provider fails', async () => {
 const f=setup(); const original=fs.readFileSync(f.file,'utf8');
 const tool=new I18nAutomation(f.root,'fixture-key');
 vi.spyOn(tool as any,'translateBatch').mockRejectedValue(new Error('provider unavailable'));
 await expect(tool.processLocales(f.root,'fr')).rejects.toThrow('provider unavailable');
 expect(fs.readFileSync(f.file,'utf8')).toBe(original);
});
it('does not call the provider or alter catalogs without a key when translations are missing', async () => {
 const f=setup(), tool=new I18nAutomation(f.root); const request=vi.spyOn(tool as any,'translateBatch');
 await expect(tool.processLocales(f.root,'fr')).rejects.toThrow('OPENAI_API_KEY'); expect(request).not.toHaveBeenCalled();
 expect(fs.readFileSync(f.file,'utf8')).toBe('{}');
});
it('fills empty translations and preserves placeholder definitions', async () => {
 const f=setup({save:{message:''}}), tool=new I18nAutomation(f.root,'fixture-key');
 vi.spyOn(tool as any,'translateBatch').mockResolvedValue({save:'Enregistrer $name$'});
 await tool.processLocales(f.root,'fr');
 expect(JSON.parse(fs.readFileSync(f.file,'utf8')).save).toEqual({message:'Enregistrer $name$',placeholders:{name:{content:'$1'}}});
});
it('rejects changed placeholders without overwriting the target catalog', async () => {
 const f=setup(), tool=new I18nAutomation(f.root,'fixture-key');
 vi.spyOn(tool as any,'translateBatch').mockResolvedValue({save:'Enregistrer'});
 await expect(tool.processLocales(f.root,'fr')).rejects.toThrow('placeholder');
 expect(fs.readFileSync(f.file,'utf8')).toBe('{}');
});
it('stops after bounded retries on persistent rate limiting', async () => {
 vi.useFakeTimers(); const f=setup(), tool=new I18nAutomation(f.root,'fixture-key');
 const fetch=vi.fn().mockResolvedValue({ok:false,status:429,statusText:'Too Many Requests',headers:new Headers(),text:()=>Promise.resolve('rate limited')});vi.stubGlobal('fetch',fetch);
 const result=(tool as any).makeRequestWithRetry([]).catch((error:Error)=>error);
 // Advance one timer at a time: an unbounded recursion remains observable without hanging the test.
 for(let i=0;i<8;i++) await vi.advanceTimersByTimeAsync(4000);
 expect(fetch.mock.calls.length).toBeLessThanOrEqual(4);
 expect(await result).toBeInstanceOf(Error);
});
