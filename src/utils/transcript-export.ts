import type { ClipSyncAction } from './clip-bar';
import { transcriptHeadingTools } from './transcript-heading';
import { createMarkdownContent } from 'defuddle/full';
import { type ClipPreview, updateClipPreview } from './clip-preview';
import { generateFrontmatter } from './obsidian-note-creator';

import { t } from './ui-text';
import { captionModeMenu } from './caption-mode-menu';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { ensureTranscriptTranslation } from './youtube-translation';
import { isChineseCaption } from './caption-clock';
export type TranscriptExportMode = 'original' | 'translated' | 'bilingual';
export function translatedCount(transcript: Element): { ready: number; total: number } {
 const segments = Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'));
 return { ready: segments.filter(s => s.dataset.translationReady === 'true' && typeof s.dataset.translatedText === 'string').length, total: segments.length };
}
// Clone only the caption content, never player controls or live-reader affordances.
export function exportTranscript(transcript: Element, url: string, mode: TranscriptExportMode): string {
 const clone = transcript.cloneNode(true) as HTMLElement;
 clone.querySelectorAll('.transcript-heading-tools, .transcript-translation, .transcript-scrub-track, button, input, select, style').forEach(el => el.remove());
 for (const segment of Array.from(clone.querySelectorAll<HTMLElement>('.transcript-segment'))) {
  const translation = segment.dataset.translationReady === 'true' ? segment.dataset.translatedText?.trim() : '';
  if (mode === 'original') continue;
  if (!translation) {if(mode==='translated'&&segment.dataset.translationReady==='true'){const timestamp=segment.querySelector('strong')?.cloneNode(true);segment.replaceChildren();if(timestamp)segment.append(timestamp);}continue;}
  const original = segment.cloneNode(true) as HTMLElement; original.querySelector('strong')?.remove();
  if (original.textContent?.replace(/^\s*·\s*/, '').replace(/\s+/g, ' ').trim() === translation.replace(/\s+/g, ' ').trim()) continue;
  const translated = clone.ownerDocument.createElement('div');
  for (const text of translation.split(/\n\s*\n/)) { const p = clone.ownerDocument.createElement('p'); p.textContent = text; translated.append(p); }
  if (mode === 'translated') {
   const timestamp = segment.querySelector('strong')?.cloneNode(true);
   segment.replaceChildren(); if (timestamp) segment.append(timestamp, clone.ownerDocument.createTextNode(' · '));
  }
  segment.append(translated);
 }
 return createMarkdownContent(clone.outerHTML, url).trim();
}

export function replaceTranscriptExport(markdown: string, previous: string, next: string): string {
 const index = previous ? markdown.indexOf(previous) : -1;
 // A template can omit content. Include a dedicated caption section in that case.
 if (index < 0) return t('{0}\n\n## 字幕\n\n{1}\n', [markdown.trimEnd(), next]);
 return markdown.slice(0, index) + next + markdown.slice(index + previous.length);
}

export function mountTranscriptExport(bar: HTMLElement, draft: ClipPreview): (action?: ClipSyncAction) => Promise<void> {
 const doc=bar.ownerDocument;
 type Preference=TranscriptExportMode|'display';
 let preference:Preference=draft.transcriptExport?.mode||'display',revision=0;
 const label=doc.createElement('div');label.className='clip-transcript-export';
 const name=doc.createElement('span');name.textContent=t('剪藏内容');
 const menu=captionModeMenu(doc,t('剪藏内容'),[
  {value:'display',label:t('跟随文稿')},{value:'original',label:t('原文')},{value:'translated',label:t('中文')},{value:'bilingual',label:t('双语')}
 ],preference,next=>{revision++;preference=next;void setLocalStorage('qiaomuTranscriptExportMode',next).catch(()=>{});});
 const progress=doc.createElement('span');progress.setAttribute('role','status');
 const cancel=doc.createElement('button');cancel.type='button';cancel.className='clip-transcript-cancel';cancel.textContent=t('取消');cancel.hidden=true;
 let saving:AbortController|undefined;
 cancel.onclick=()=>saving?.abort();
 label.append(name,menu.element,progress,cancel);
 const preferenceReady=getLocalStorage('qiaomuTranscriptExportMode').then(value=>{
  if(revision||draft.transcriptExport?.mode||!['display','original','translated','bilingual'].includes(value))return;
  preference=value as Preference;menu.set(preference);
 }).catch(()=>{});
 const refresh=()=>{
  const transcript=doc.querySelector('article .transcript');
  if(transcript){const tools=transcriptHeadingTools(transcript);if(label.parentElement!==tools)tools.append(label);}else label.remove();
  label.hidden=!transcript?.querySelector('.transcript-segment');
 };
 const observer=new MutationObserver(refresh);const article=doc.querySelector('article');
 if(article)observer.observe(article,{childList:true,subtree:true});refresh();
 if(!doc.getElementById('clip-transcript-export-style')){
  const style=doc.createElement('style');style.id='clip-transcript-export-style';
  style.textContent=`html .clip-transcript-export{display:inline-flex;gap:6px;align-items:center;font-size:12px;flex-wrap:wrap;min-width:0;max-width:100%}html .clip-transcript-export[hidden],html .clip-transcript-cancel[hidden]{display:none!important}html .clip-transcript-export [role=status]{min-width:0;max-width:min(100%,220px);overflow-wrap:anywhere;color:var(--text-muted,#666)}html button.clip-transcript-cancel{appearance:none;width:auto;min-height:28px;padding:4px 8px;border:0;border-radius:5px;background:var(--background-secondary,#eee);color:var(--text-normal,#222);box-shadow:none;font:inherit;cursor:pointer}html button.clip-transcript-cancel:hover{background:var(--background-modifier-hover,#ddd)}html button.clip-transcript-cancel:focus-visible{outline:1px solid var(--text-muted,#777);outline-offset:2px}`;
  doc.head.append(style);
 }
 return async(action='clip')=>{
  await preferenceReady;
  const transcript=doc.querySelector('article .transcript');if(!transcript)return;
  refresh();progress.textContent='';
  const visibleTranslation=Boolean(transcript.querySelector<HTMLInputElement>('.youtube-translate-toggle input')?.checked||article?.querySelector<HTMLInputElement>('.youtube-translate-toggle input')?.checked||transcript.querySelector('.transcript-translation:not([hidden])'));
  const followsDisplay=action!=='clip'||preference==='display';
  const mode:TranscriptExportMode=followsDisplay?(visibleTranslation?'bilingual':'original'):preference as TranscriptExportMode;
  if(action==='clip'&&mode!=='original'){
   if(saving)throw new Error(t('正在翻译，完成后剪藏'));
   // Chinese source needs no provider, and can be saved without changing the reading view.
   for(const segment of Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'))){
    const clone=segment.cloneNode(true) as HTMLElement;clone.querySelectorAll('strong,.transcript-translation').forEach(node=>node.remove());
    const text=clone.textContent?.replace(/^\s*·\s*/,'').trim()||'';
    if(isChineseCaption(text)){segment.dataset.translatedText=text;segment.dataset.translationReady='true';}
   }
   const count=translatedCount(transcript);
   if(count.ready<count.total){
    const request=new AbortController();saving=request;menu.button.disabled=true;cancel.hidden=false;
    progress.textContent=t('正在翻译，完成后剪藏');
    try{
     await ensureTranscriptTranslation(transcript,request.signal);
     if(request.signal.aborted)throw new Error(t('剪藏已取消'));
     if(doc.querySelector('article .transcript')!==transcript)throw new Error(t('文稿已更换，请重新剪藏'));
     const done=translatedCount(transcript);if(done.ready<done.total)throw new Error(t('文稿翻译未完成，请重试后剪藏'));
    }catch(error){progress.textContent=error instanceof Error?error.message:t('文稿翻译未完成，请重试后剪藏');throw error;}
    finally{saving=undefined;menu.button.disabled=false;cancel.hidden=true;}
   }
  }
  const source=draft.transcriptExport?.source||exportTranscript(transcript,draft.clip.url,'original');
  const previous=draft.transcriptExport?.previous||source;
  if(mode==='original'&&previous===source){if(draft.transcriptExport)draft.transcriptExport.mode=preference;return;}
  const next=mode==='original'?source:exportTranscript(transcript,draft.clip.url,mode);
  const updated={...draft,clip:{...draft.clip,markdown:replaceTranscriptExport(draft.clip.markdown,previous,next)},local:{...draft.local},transcriptExport:{source,previous:next,mode:preference}};
  updated.local.content=await generateFrontmatter(draft.properties??[])+updated.clip.markdown;
  await updateClipPreview(updated,draft);Object.assign(draft,updated);progress.textContent='';
 };
}
