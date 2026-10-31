import { expect, it, vi } from 'vitest';
import { openAiSidebar } from './ai-sidebar';
it('opens synchronously within the gesture even while option registration is pending',async()=>{
 let resolve!:()=>void;
 const setOptions=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
 const open=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('chrome',{sidePanel:{setOptions,open}});
 const pending=openAiSidebar(14);
 expect(setOptions).toHaveBeenCalledWith({path:'ai-side-panel.html',enabled:true});
 expect(open).toHaveBeenCalledWith({windowId:14});
 resolve();await pending;vi.unstubAllGlobals();
});
