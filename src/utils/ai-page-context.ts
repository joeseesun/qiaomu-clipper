import Defuddle, { createMarkdownContent } from './defuddle';

// Serialized by Chrome: keep self-contained and never change the live page.
export function snapshotAiPage() {
 const active = document.activeElement;
 const selection = active && (active.matches('input, textarea') || (active as HTMLElement).isContentEditable) ? '' : (window.getSelection()?.toString() || '').slice(0, 4000);
 const copy = document.documentElement.cloneNode(true) as HTMLElement;
 copy.querySelectorAll('script, style, noscript, input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"]').forEach(node => node.remove());
 const html = copy.outerHTML;
 // Use the same sanitized snapshot for the large-page/parser-failure fallback.
 // Reading innerText from the live page would reintroduce editable drafts.
 copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
 const text = (copy.querySelector('article, main, [role="main"]') || copy).textContent || '';
 return { url: location.href, title: document.title, html: html.length <= 2000000 ? html : '', text: text.slice(0, 80000), selection };
}
export type AiSnapshot = ReturnType<typeof snapshotAiPage>;
export function parseAiPage(snapshot: AiSnapshot): { title: string; url: string; markdown: string } {
 let markdown = snapshot.text;
 if (snapshot.html) {
  try {
   const doc = new DOMParser().parseFromString(snapshot.html, 'text/html');
   const parsed = new Defuddle(doc, { url: snapshot.url }).parse();
   if (parsed.content) markdown = createMarkdownContent(parsed.content, snapshot.url);
  } catch { /* Visible text is still a truthful fallback. */ }
 }
 return { title: snapshot.title, url: snapshot.url, markdown: markdown.slice(0, 80000) };
}
export function sameAiPage(expected: string, actual: string): boolean {
 // Hashes may identify distinct SPA routes; conservatively isolate every URL.
 try { return new URL(expected).href === new URL(actual).href; } catch { return expected === actual; }
}
