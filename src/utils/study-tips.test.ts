// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {mountStudyTips,studyTips} from './study-tips';
const state=vi.hoisted(()=>({saved:false}));
vi.mock('./storage-utils',()=>({getLocalStorage:async()=>state.saved,setLocalStorage:async(_k:string,v:boolean)=>{state.saved=v;}}));
afterEach(()=>{state.saved=false;document.body.innerHTML='';vi.restoreAllMocks();});
it('cycles tips and remembers dismissal across remounts',async()=>{vi.spyOn(Math,'random').mockReturnValue(0);const stop=mountStudyTips(document.body);await Promise.resolve();const root=document.querySelector<HTMLElement>('.q-study-tips')!;expect(root.hidden).toBe(false);const text=root.querySelector('.q-study-tip-text')!;expect(text.textContent).toContain('10');root.querySelector<HTMLButtonElement>('button')!.click();expect(text.textContent).toContain('A');root.querySelectorAll<HTMLButtonElement>('button')[1].click();expect(root.hidden).toBe(true);stop();const stop2=mountStudyTips(document.body);await Promise.resolve();expect(document.querySelector<HTMLElement>('.q-study-tips')!.hidden).toBe(true);stop2();});

it('places tips beneath a late-mounted player toolbar and restores that order after replacement',async()=>{
 const container=document.createElement('div');container.className='player-container';document.body.append(container);
 const stop=mountStudyTips(container);const tips=container.querySelector('.q-study-tips')!;
 const toolbar=document.createElement('div');toolbar.className='player-toggles';container.append(toolbar);
 await Promise.resolve();expect(toolbar.nextElementSibling).toBe(tips);
 toolbar.remove();const next=toolbar.cloneNode() as HTMLElement;container.append(next);await Promise.resolve();expect(next.nextElementSibling).toBe(tips);
 stop();expect(container.querySelector('.q-study-tips')).toBeNull();
});
it('covers study, notes, reading, AI, clipping and settings without duplicate tips',()=>{
 const tips=studyTips();expect(tips.length).toBeGreaterThanOrEqual(25);expect(new Set(tips).size).toBe(tips.length);
 for(const topic of ['时间戳','画中画','官方字幕','云端','日记','划线','图片','模板','Markdown','RSS','导入设置'])expect(tips.some(tip=>tip.includes(topic))).toBe(true);
});
