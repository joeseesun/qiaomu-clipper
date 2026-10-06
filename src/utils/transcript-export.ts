import { createMarkdownContent } from 'defuddle/full';
import { type ClipPreview, updateClipPreview } from './clip-preview';
import { generateFrontmatter } from './obsidian-note-creator';

export type TranscriptExportMode = 'original' | 'translated' | 'bilingual';
export function translatedCount(transcript: Element): { ready: number; total: number } {
 const segments = Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'));
 return { ready: segments.filter(s => s.dataset.translationReady === 'true' && s.dataset.translatedText?.trim()).length, total: segments.length };
}
// Clone only the caption content, never player controls or live-reader affordances.
export function exportTranscript(transcript: Element, url: string, mode: TranscriptExportMode): string {
 const clone = transcript.cloneNode(true) as HTMLElement;
 clone.querySelectorAll('.transcript-translation, .transcript-scrub-track, button, input, select, style').forEach(el => el.remove());
 for (const segment of Array.from(clone.querySelectorAll<HTMLElement>('.transcript-segment'))) {
  const translation = segment.dataset.translationReady === 'true' ? segment.dataset.translatedText?.trim() : '';
  if (mode === 'original' || !translation) continue;
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
 if (index < 0) return `${markdown.trimEnd()}\n\n## 字幕\n\n${next}\n`;
 return markdown.slice(0, index) + next + markdown.slice(index + previous.length);
}

export function mountTranscriptExport(bar: HTMLElement, draft: ClipPreview): () => Promise<void> {
 const doc = bar.ownerDocument, label = doc.createElement('label'); label.className = 'clip-transcript-export'; label.hidden = true;
 const name = doc.createElement('span'); name.textContent = '剪藏字幕';
 const select = doc.createElement('select'); select.setAttribute('aria-label', '剪藏字幕内容');
 for (const [value, text] of [['original','原文'],['translated','译文'],['bilingual','双语']]) {
  const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option);
 }
 select.value = draft.transcriptExport?.mode || 'bilingual';
 const progress = doc.createElement('span'); progress.setAttribute('role', 'status'); label.append(name, select, progress);
 bar.querySelector('#clip-bar-clip')?.before(label);
 const refresh = () => {
  const transcript = doc.querySelector('article .transcript'); const count = transcript ? translatedCount(transcript) : { ready: 0, total: 0 };
  label.hidden = !count.ready;
  (select.querySelector('option[value="translated"]') as HTMLOptionElement).disabled = count.ready < count.total;
  if (select.value === 'translated' && count.ready < count.total) select.value = 'bilingual';
  progress.textContent = count.ready && count.ready < count.total ? `${count.ready}/${count.total} 已翻译，未完成部分保留原文` : '';
 };
 const observer = new MutationObserver(refresh); const article = doc.querySelector('article');
 if (article) observer.observe(article, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-translation-ready','data-translated-text'] });
 refresh();
 if (!doc.getElementById('clip-transcript-export-style')) {
  const style = doc.createElement('style'); style.id = 'clip-transcript-export-style';
  style.textContent = `html .clip-transcript-export{display:inline-flex;gap:6px;align-items:center;font-size:12px}html .clip-transcript-export[hidden]{display:none}html .clip-transcript-export select{appearance:none;width:auto;min-height:28px;padding:3px 8px;border:1px solid var(--background-modifier-border,#bbb);border-radius:6px;background:var(--background-primary,#fff);color:var(--text-normal,#222)}html .clip-transcript-export select:focus-visible{outline:2px solid var(--text-accent,#666);outline-offset:2px}html .clip-transcript-export [role=status]{max-width:180px}`;
  doc.head.append(style);
 }
 return async () => {
  const transcript = doc.querySelector('article .transcript'); if (!transcript) return;
  refresh();
  const mode = label.hidden ? 'original' : select.value as TranscriptExportMode;
  const source = draft.transcriptExport?.source || exportTranscript(transcript, draft.clip.url, 'original');
  const previous = draft.transcriptExport?.previous || source;
  if (mode === 'original' && previous === source) { if (draft.transcriptExport) draft.transcriptExport.mode = select.value as TranscriptExportMode; return; }
  const next = mode === 'original' ? source : exportTranscript(transcript, draft.clip.url, mode);
  draft.clip.markdown = replaceTranscriptExport(draft.clip.markdown, previous, next);
  draft.transcriptExport = { source, previous: next, mode: select.value as TranscriptExportMode };
  draft.local.content = await generateFrontmatter(draft.properties ?? []) + draft.clip.markdown;
  await updateClipPreview(draft);
 };
}
