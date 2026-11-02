import { afterEach, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { openAiSidebar, openCurrentAiSidebar, disableGlobalSidebar } from './ai-sidebar';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('opens synchronously within the gesture even while option registration is pending',async()=>{
 let resolve!:()=>void;
 const setOptions=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
 const open=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('chrome',{sidePanel:{setOptions,open}});
 const pending=openAiSidebar({ tabId: 14 });
 expect(setOptions).toHaveBeenCalledWith({tabId:14,path:'ai-side-panel.html?tab=14',enabled:true});
 expect(open).toHaveBeenCalledWith({tabId:14});
 resolve();await pending;
});
it('uses the active tab id, not its window id, from the popup', async () => {
 const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 42, windowId: 7 }] as any);
 const setOptions = vi.fn().mockResolvedValue(undefined), open = vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('chrome', { sidePanel: { setOptions, open } });
 await openCurrentAiSidebar();
 expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
 expect(open).toHaveBeenCalledWith({ tabId: 42 });
 expect(setOptions).toHaveBeenCalledWith({ tabId: 42, path: 'ai-side-panel.html?tab=42', enabled: true });
});
it('disables the global fallback without disabling any tab-specific panel', async () => {
 const setOptions = vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('chrome', { sidePanel: { setOptions } });
 await disableGlobalSidebar();
 expect(setOptions).toHaveBeenCalledExactlyOnceWith({ path: 'side-panel.html', enabled: false });
});
it('does not enable or open any panel without a valid source tab', async () => {
 const setOptions = vi.fn(), open = vi.fn();
 vi.stubGlobal('chrome', { sidePanel: { setOptions, open } });
 await expect(openAiSidebar({ tabId: -1 })).rejects.toThrow('source tab');
 expect(setOptions).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
it('keeps legacy numeric callers scoped to the active tab of their window', async () => {
 const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 42, windowId: 7 }] as any);
 const setOptions = vi.fn().mockResolvedValue(undefined), open = vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('chrome', { sidePanel: { setOptions, open } });
 await openAiSidebar(7);
 expect(query).toHaveBeenCalledWith({ active: true, windowId: 7 });
 expect(open).toHaveBeenCalledExactlyOnceWith({ tabId: 42 });
});
