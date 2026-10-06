// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('./clip-preview', () => ({updateClipPreview:vi.fn()}));
vi.mock('./obsidian-note-creator', () => ({generateFrontmatter:async () => '---\ntitle: Study\n---\n'}));
import { exportTranscript, mountTranscriptExport, replaceTranscriptExport } from './transcript-export';
import type { ClipPreview } from './clip-preview';
const setup = () => {
 document.body.innerHTML='<div id="bar"><button id="clip-bar-clip"></button></div><article><div class="transcript"><h2>Transcript</h2><p class="transcript-segment"><strong><span class="timestamp" data-timestamp="3.863">0:03</span></strong> · First source</p><p class="transcript-segment"><strong>0:08</strong> · Second source</p></div></article>';
 const transcript=document.querySelector<HTMLElement>('.transcript')!, segments=Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'));
 const source=exportTranscript(transcript, 'https://ted.com/talks/example','original');
 const draft={clip:{url:'https://ted.com/talks/example',title:'Study',markdown:`Description\n\n${source}\n\nAI notes`}, local:{requestId:'id',content:'',name:'Study.md',folder:'Clips',vault:'Daily',behavior:'create'},properties:[],transcriptExport:{source,previous:source},native:true,aggregate:false} as ClipPreview;
 const sync=mountTranscriptExport(document.getElementById('bar')!,draft); const select=document.querySelector('select')!;
 return {transcript,segments,draft,sync,select};
};
it('defaults to bilingual, keeps untranslated source and disables translation-only until all cues are translated',async()=>{
 const {segments,draft,sync,select}=setup(); segments[0].dataset.translatedText='第一段'; segments[0].dataset.translationReady='true'; await Promise.resolve();
 expect(select.value).toBe('bilingual'); expect((select.options[1]).disabled).toBe(true);
 await sync(); expect(draft.local.content).toContain('第一段'); expect(draft.local.content).toContain('Second source'); expect(draft.local.content).toContain('0:03'); expect(draft.local.content).toContain('title: Study');
 expect(draft.clip.markdown.startsWith('Description')).toBe(true); expect(draft.clip.markdown.endsWith('AI notes')).toBe(true);
 segments[1].dataset.translatedText='第二段'; segments[1].dataset.translationReady='true'; await Promise.resolve();
 select.value='translated'; await sync(); expect(draft.clip.markdown).toContain('第二段'); expect(draft.clip.markdown).not.toContain('First source'); expect(draft.clip.markdown).toContain('0:08');
 select.value='original'; await sync(); expect(draft.clip.markdown).toContain('First source'); expect(draft.clip.markdown).not.toContain('第一段'); expect(draft.clip.markdown.endsWith('AI notes')).toBe(true);
});
it('keeps translated provider markup inert and exports no live controls',()=>{
 const {transcript,segments}=setup(); segments[0].dataset.translatedText='<img src=x onerror=alert(1)>译文'; segments[0].dataset.translationReady='true';
 const control=document.createElement('button');control.textContent='Do not export';transcript.append(control);
 const markdown=exportTranscript(transcript,'https://ted.com','bilingual'); expect(markdown).not.toContain('Do not export');expect(markdown).toContain('\\<img src=x'); expect(transcript.querySelector('img')).toBeNull();
});
it('does not append subtitles to a content-free template until translated export is requested; then includes them only once', async()=>{
 const {draft,segments,sync}=setup();draft.clip.markdown='Custom metadata only'; await sync();expect(draft.clip.markdown).toBe('Custom metadata only');
 segments[0].dataset.translatedText='译文';segments[0].dataset.translationReady='true'; await sync();await sync();
 expect(draft.clip.markdown.match(/## 字幕/g)).toHaveLength(1);expect(draft.clip.markdown.match(/译文/g)).toHaveLength(1);
 expect(replaceTranscriptExport('prefix source suffix','source','next')).toBe('prefix next suffix');
});
