// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {captionWordRanges,normalizeCaptionWords,paintCaptionWords} from './caption-words';
const words=[{start:1,end:1.5,text:'Hello'},{start:2,end:3,text:'world'}];
it('preserves spaces and punctuation, updates stable spans and rewinds highlighting',()=>{
 const el=document.createElement('div');paintCaptionWords(el,'Hello, world!',words,1.2);
 const first=el.firstElementChild;expect(el.textContent).toBe('Hello, world!');
 paintCaptionWords(el,'Hello, world!',words,1.8);expect(el.firstElementChild).toBe(first);expect(el.querySelector('[data-active=true]')).toBeNull();
 paintCaptionWords(el,'Hello, world!',words,2.3);expect(el.querySelector('[data-active=true]')?.textContent).toBe('world');
 paintCaptionWords(el,'Hello, world!',words,.5);expect(el.querySelector('[data-sung=true]')).toBeNull();
});
it('does not fabricate alignment for normalized numbers, missing words or edited text',()=>{
 expect(captionWordRanges('123 dollars',[{start:0,end:1,text:'one hundred twenty three dollars'}])).toBeUndefined();
 expect(captionWordRanges('Hello there, world!',words)).toBeUndefined();
 expect(normalizeCaptionWords([{start:NaN,end:1,text:'x'}],0,2)).toBeUndefined();
 expect(normalizeCaptionWords([{start:0,end:1,text:'x'},{start:.5,end:2,text:'y'}],0,2)).toBeUndefined();
 expect(normalizeCaptionWords(words,0,2)).toBeUndefined();
});
it('renders HTML-looking transcripts as text and falls back safely when timings disappear',()=>{
 const el=document.createElement('div'),text='<img src=x>你好！';
 paintCaptionWords(el,text,[{start:0,end:1,text:'img src x你'},{start:1,end:2,text:'好'}],1.5);
 expect(el.querySelector('img')).toBeNull();expect(el.textContent).toBe(text);
 paintCaptionWords(el,'Hello, world!',words,2);expect(el.querySelectorAll('span')).toHaveLength(2);
 paintCaptionWords(el,'Hello, world!',undefined,2);expect(el.querySelector('span')).toBeNull();
});
it('supports supplementary Unicode characters and repeated Chinese syllables',()=>{
 const w=[{start:0,end:1,text:'𠮷'},{start:1,end:2,text:'刚'},{start:2,end:3,text:'刚'}];
 expect(captionWordRanges('𠮷刚刚。',w)).toEqual([{from:0,to:2},{from:2,to:3},{from:3,to:4}]);
});
