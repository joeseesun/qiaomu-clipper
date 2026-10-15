// Shared wire format: seconds on the original media timeline, never estimated from character counts.
export interface CaptionWord { start:number; end:number; text:string }
export function normalizeCaptionWords(raw:unknown,start:number,end:number):CaptionWord[]|undefined {
 if(!Array.isArray(raw)||!raw.length||raw.length>4096)return;
 let previous=start;
 const words:CaptionWord[]=[];
 for(const word of raw){
  if(!word || typeof word.text!=='string' || !word.text.trim() || word.text.length>256 ||
   !Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<start-.001||word.end>end+.001||word.end<=word.start||word.start<previous-.001)return;
  words.push({start:Math.max(start,word.start),end:Math.min(end,word.end),text:word.text.trim()});previous=word.end;
 }
 return words;
}
const isSpoken=(char:string)=>/[\p{L}\p{N}\p{M}]/u.test(char);
// Preserve every displayed character (punctuation, spaces, casing and HTML-looking text).
// ITN or edited text may not match the spoken tokens: use plain captions rather than invent alignment.
export function captionWordRanges(text:string,words:CaptionWord[]):Array<{from:number;to:number}>|undefined {
 const letters:Array<{char:string;from:number;to:number}>=[];let offset=0;
 for(const char of text){if(isSpoken(char))letters.push({char,from:offset,to:offset+char.length});offset+=char.length;}
 let at=0;const ranges:Array<{from:number;to:number}>=[];
 for(const word of words){
  const spoken=[...word.text].filter(isSpoken);
  if(!spoken.length)return;
  const from=letters[at]?.from;
  for(const char of spoken){if(letters[at]?.char.toLowerCase()!==char.toLowerCase())return;at++;}
  ranges.push({from,to:letters[at-1].to});
 }
 return at===letters.length?ranges:undefined;
}
interface Painted { text:string; words?:CaptionWord[]; spans:HTMLElement[] }
const painted=new WeakMap<HTMLElement,Painted>();
export function paintCaptionWords(element:HTMLElement,text:string,words:CaptionWord[]|undefined,time:number):void {
 let state=painted.get(element);
 if(!state||state.text!==text||state.words!==words){
  const ranges=words?.length?captionWordRanges(text,words):undefined;
  state={text,words,spans:[]};painted.set(element,state);
  if(!ranges){element.textContent=text;return;}
  const doc=element.ownerDocument;
  if(!doc.getElementById('q-caption-word-style')){
   const style=doc.createElement('style');style.id='q-caption-word-style';
   style.textContent='html .q-caption-word[data-sung="true"]{color:#ffe066!important}html .q-caption-word[data-active="true"]{color:#ffe066!important;text-decoration:underline;text-decoration-thickness:.07em;text-underline-offset:.14em}';
   doc.head.append(style);
  }
  const fragment=doc.createDocumentFragment();let at=0;
  ranges.forEach(({from,to})=>{
   fragment.append(doc.createTextNode(text.slice(at,from)));
   const span=doc.createElement('span');span.className='q-caption-word';span.textContent=text.slice(from,to);state!.spans.push(span);fragment.append(span);at=to;
  });
  fragment.append(doc.createTextNode(text.slice(at)));element.replaceChildren(fragment);
 }
 state.spans.forEach((span,i)=>{
  const word=words![i],sung=String(time>=word.start),active=String(time>=word.start&&time<word.end);
  if(span.dataset.sung!==sung)span.dataset.sung=sung;
  if(span.dataset.active!==active)span.dataset.active=active;
 });
}
