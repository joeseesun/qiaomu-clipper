// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { probeXiaoeLive } from './web-study-probe';
const address='https://appfixture123.h5.xiaoeknow.com/v4/course/alive/l_fixture123456?app_id=appfixture123';
const login={ok:false as const,error:'login' as const,address,loginUrl:'https://appfixture123.h5.xiaoeknow.com/login'};
const success={ok:true as const,address,info:{ok:true as const,title:'Fixture',author:'Fixture shop',site:'小鹅通',seconds:12,thumbnail:null,mediaUrl:'https://video.xet.tech/fixture.m3u8',video:true}};
beforeEach(()=>{vi.useFakeTimers();document.body.innerHTML='<p id="status"></p><div id="holder"></div>';});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.useRealTimers();});
const ui=(read:any,open:any)=>probeXiaoeLive(document.getElementById('status')!,document.getElementById('holder')!,read,open);
it('opens the original login page without letting reader link-following take over, then continues automatically',async()=>{
 const read=vi.fn().mockResolvedValueOnce(login).mockResolvedValue(success),open=vi.fn(),bubbled=vi.fn();const done=ui(read,open);await vi.advanceTimersByTimeAsync(0);
 document.getElementById('holder')!.addEventListener('click',bubbled);const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('a')!.dispatchEvent(click);
 expect(click.defaultPrevented).toBe(true);expect(bubbled).not.toHaveBeenCalled();expect(open).toHaveBeenCalledWith(login.loginUrl);
 await vi.advanceTimersByTimeAsync(3000);expect(await done).toEqual({info:success.info,address});await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(2);
});
it('does not loop indefinitely or poll after the reader closes',async()=>{
 const read=vi.fn().mockResolvedValue(login);void ui(read,vi.fn());await vi.advanceTimersByTimeAsync(0);document.querySelector('a')!.click();await vi.advanceTimersByTimeAsync(184000);const count=read.mock.calls.length;await vi.advanceTimersByTimeAsync(20000);expect(read).toHaveBeenCalledTimes(count);
 window.dispatchEvent(new Event('pagehide'));expect(vi.getTimerCount()).toBe(0);
});
it('returns permission and no-replay failures without reporting subtitle completion',async()=>{
 const read=vi.fn().mockResolvedValue({ok:false,error:'denied',message:'No access'});expect(await ui(read,vi.fn())).toEqual({error:'denied',message:'No access'});expect(document.querySelector('video')).toBeNull();
});
