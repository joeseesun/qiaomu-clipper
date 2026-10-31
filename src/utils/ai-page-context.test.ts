// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { snapshotAiPage, parseAiPage, sameAiPage } from './ai-page-context';
it('serializes without module dependencies, leaves the page intact and excludes form values', () => {
 document.title = 'Source article';
 document.body.innerHTML = '<main><h1>Source article</h1><p>Independent evidence about the moon. '.repeat(20) + '</p></main><input value="private-secret"><script>bad()</script><textarea>private-draft</textarea>';
 const before = document.documentElement.outerHTML;
 const serialized = (0, eval)('(' + snapshotAiPage.toString() + ')');
 const snapshot = serialized();
 expect(document.documentElement.outerHTML).toBe(before);
 expect(snapshot.html).not.toContain('private-secret');
 expect(snapshot.html).not.toContain('private-draft');
 expect(snapshot.html).not.toContain('<script>');
 expect(snapshot.text).not.toContain('private-secret');
 expect(snapshot.text).not.toContain('private-draft');
 expect(parseAiPage({...snapshot, html: ''}).markdown).not.toContain('private-draft');
 const context = parseAiPage(snapshot);
 expect(context.markdown).toContain('Independent evidence');
 expect(context.title).toBe('Source article');
});
it('captures page selection and isolates fragment navigation including SPA routes', () => {
 document.body.innerHTML = '<p>Quote this sentence</p>';
 const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
 window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
 expect(snapshotAiPage().selection).toBe('Quote this sentence');
 expect(sameAiPage('https://example.com/a#first', 'https://example.com/a#second')).toBe(false);
 expect(sameAiPage('https://example.com/#/a', 'https://example.com/#/b')).toBe(false);
 expect(sameAiPage('https://example.com/a', 'https://example.com/a')).toBe(true);
 expect(sameAiPage('https://example.com/a', 'https://example.com/b')).toBe(false);
 expect(sameAiPage('https://example.com/a?x=1', 'https://example.com/a?x=2')).toBe(false);
});
it('preserves code indentation through the shared extraction and Markdown boundary', () => {
 const code = 'build:\n\tprintf \"hello\"\\n\n    aligned    columns\n';
 document.body.innerHTML = '<article><h1>Build guide</h1><p>' + 'How to build a project with a Makefile. '.repeat(30) + '</p><pre><code></code></pre></article>';
 document.querySelector('code')!.textContent = code;
 const context = parseAiPage(snapshotAiPage());
 expect(context.markdown).toContain(code.trimEnd());
});
