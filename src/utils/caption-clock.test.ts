import { expect,it } from 'vitest';
import { CaptionClock,isChineseCaption } from './caption-clock';
it('interpolates confirmed playback with rate, then freezes on buffering or missing samples',()=>{
 const clock=new CaptionClock();clock.sample(10,2,true,0);expect(clock.read(400)).toBe(10.8);expect(clock.read(2000)).toBe(12);
 clock.sample(11,undefined,false,500);expect(clock.read(1000)).toBe(11);clock.sample(40,1,true,1100);expect(clock.read(1300)).toBe(40.2);
 clock.sample(undefined,undefined,false,1400);expect(clock.read(1500)).toBe(40.3);
});
it('does not guess that an iframe is playing, and detects Chinese conservatively',()=>{
 const clock=new CaptionClock();clock.sample(5,1,undefined,0);expect(clock.read(700)).toBe(5);
 expect(isChineseCaption('这是中文。')).toBe(true);expect(isChineseCaption('Hello')).toBe(false);expect(isChineseCaption('你好、こんにちは')).toBe(false);
});
