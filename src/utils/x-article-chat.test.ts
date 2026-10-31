import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ stream: vi.fn(), fetch: vi.fn(), read: vi.fn() }));
vi.mock('./chat-llm', () => ({ streamChat: mocks.stream }));
vi.mock('./x-article-client', () => ({ fetchXArticle: mocks.fetch, readXArticle: mocks.read, xArticleError: (e: Error) => e.message }));
import { splitXSource, parseXTranslation, translateXArticles, loadXArticles } from './x-article-chat';
import { streamChatAgent } from './chat-agent';
import { xArticleUrl, xLinksInText, wantsXTranslation, type XArticle } from './x-article';
import { normalizeToolResults } from './chat-tools-types';
import { marked } from 'marked';
import { ChatCapacityError } from './chat-capacity';
const url = 'https://x.com/poteto/status/2094457600259842065';
const source: XArticle = { url, title: 'The guide', author: 'Lauren', content: 'Some words.', kind: 'article', sha256: 'a'.repeat(64), complete: true, provenance: 'x-original-page' };
const options = (extra: any = {}): any => ({ model: { id: 'test' }, messages: [{ role: 'user', content: url }], system: 'system', onText: vi.fn(), onTools: vi.fn(), ...extra });
beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue(source); mocks.read.mockResolvedValue(source); });
it('retains the original language and all links when setup is needed, including after history reload', async () => {
 const request = `请完整翻译成法语 ${url}`;
 const o = options({ messages: [{ role: 'user', content: request }] });
 mocks.fetch.mockRejectedValueOnce(new Error('grok-login-required'));
 await expect(loadXArticles(o)).rejects.toThrow();
 const saved = normalizeToolResults(o.onTools.mock.lastCall[0])[0];
 expect(saved.xSetup).toBe('login'); expect(saved.xRequest).toBe(request);
 expect(mocks.stream).not.toHaveBeenCalled();
});
function echo(o: any) { const input = JSON.parse(o.messages[0].content); o.onDelta(JSON.stringify({ translations: input.blocks.map((p: any) => ({ id: p.id, text: p.source.trim() })) })); }

it('recognizes pasted share URLs but rejects paths, credentials and commands', () => {
 expect(xLinksInText(`[${url}?s=20](${url}?s=20)`)).toEqual([url]);
 expect(xLinksInText(`[${url}](${url})`)).toEqual([url]);
 expect(xArticleUrl('https://twitter.com/i/web/status/12345/photo/1')).toBe('https://x.com/i/web/status/12345');
 for (const value of ['http://x.com/a/status/12345', 'https://x.com@localhost/a/status/12345', 'https://x.com.evil/a/status/12345', url + '\n', 'https://x.com\\@evil/a/status/12345']) expect(xArticleUrl(value)).toBeUndefined();
 expect(wantsXTranslation(url)).toBe(true); expect(wantsXTranslation(`不要翻译，分析 ${url}`)).toBe(false);
});
it('segments every original character including whitespace, emoji and very long fences', () => {
 const code = '````python\n' + 'code()\n'.repeat(5000) + '```\n````\n';
 const text = '\n\nA 😀\n\n' + code + '\n![image](https://x.org/a)\n\nTHE END';
 const parts = splitXSource(text);
 expect(parts.map(p => p.source).join('')).toBe(text);
 expect(parts.find(p => p.source === code)?.literal).toBe(true);
});
it('translates beyond the former 80k limit and preserves exact code and URLs without sending code for rewrite', async () => {
 const code = '```shell\nprintf "😀\\n"\n' + '# verbatim\n'.repeat(650) + '```';
 const body = ('A full paragraph about `pstack` with 123 facts.\n\n').repeat(2100) + code + '\n\n[link](https://example.org/a?x=1)\n\nTHE LAST SENTENCE';
 mocks.stream.mockImplementation(echo);
 const o = options(); const result = await translateXArticles([{ ...source, content: body }], url, o);
 expect(result).toBe(url + '\n\n## The guide\n\n' + body);
 const requests = mocks.stream.mock.calls.map(([p]) => JSON.parse(p.messages[0].content));
 expect(requests.flatMap(p => p.blocks).slice(-1)[0].source).toContain('THE LAST SENTENCE');
 expect(requests).toHaveLength(1);
 expect(requests[0].blocks.length).toBeGreaterThan(8);
 expect(requests[0].blocks.reduce((n: number, b: any) => n + b.source.length, 0)).toBeGreaterThan(80000);
 expect(JSON.stringify(requests)).not.toContain('printf');
 expect(mocks.stream.mock.calls.every(([p]) => p.nativeTools === false)).toBe(true);
 expect(o.onText.mock.calls[0][0]).toContain('0/'); expect(o.onText.mock.lastCall[0]).not.toContain('0/');
});
it('never accepts missing blocks or altered protected tokens as a complete translation', async () => {
 const o = options(); mocks.stream.mockImplementation(p => p.onDelta('{"translations":[]}'));
 await expect(translateXArticles([source], url, o)).rejects.toThrow(); expect(mocks.stream).toHaveBeenCalledTimes(2);
 expect(o.onText.mock.lastCall[0]).toMatch(/0\/2/);
 mocks.stream.mockClear(); mocks.stream.mockImplementation(p => { const data = JSON.parse(p.messages[0].content); p.onDelta(JSON.stringify({ translations: data.blocks.map((b: any) => ({ id: b.id, text: 'deleted link' })) })); });
 await expect(translateXArticles([{ ...source, content: 'See https://example.com/ and `code`.' }], url, options())).rejects.toThrow();
 expect(mocks.stream).toHaveBeenCalledTimes(2);
 expect(() => parseXTranslation('{"translations":[{"id":2,"text":"x"}]}', [0])).toThrow();
});
it('keeps clickable link destinations when the model translates adjacent punctuation and link labels', async () => {
 const body = '- pstack: https://x.ai/bot/plugin/9717366 ([github link](https://github.com/cursor/plugins/tree/main/pstack))';
 mocks.stream.mockImplementation(o => {
  const input = JSON.parse(o.messages[0].content);
  o.onDelta(JSON.stringify({ translations: input.blocks.map((p: any) => ({ id: p.id, text: p.source.trim().replace(' (', '（').replace(/\)/g, '）').replace('github link', 'GitHub 链接') })) }));
 });
 const result = await translateXArticles([{ ...source, content: body }], url, options());
 const html = marked.parse(result) as string;
 expect(html).toContain('href="https://x.ai/bot/plugin/9717366"');
 expect(html).toContain('href="https://github.com/cursor/plugins/tree/main/pstack"');
 expect(html).toContain('GitHub 链接</a>');
 expect(result).not.toContain('XKEEP_');
});
it('does not nest protection markers or autolinks when a Markdown link label is itself a URL', async () => {
 const link = 'https://github.com/poteto/verification-skill-example';
 const body = `See [${link}](${link}), [\`code\`](https://example.org/), and <https://example.net/>.`;
 mocks.stream.mockImplementation(echo);
 const result = await translateXArticles([{ ...source, content: body }], url, options());
 expect(result).toBe(url + '\n\n## The guide\n\n' + body);
 expect(result).not.toContain('XKEEP_');
 const html = marked.parse(result) as string;
 expect(html).toContain(`href="${link}"`);
 expect(html).not.toContain('&lt;https');
});
it('does not call any model when original extraction fails, including native-tool providers', async () => {
 mocks.fetch.mockRejectedValue(new Error('x-body-missing')); const o = options({ nativeTools: true });
 await expect(streamChatAgent(o)).rejects.toThrow('x-body-missing'); expect(mocks.stream).not.toHaveBeenCalled();
 expect(o.onTools.mock.lastCall[0][0].state).toBe('error');
});
it('loads the original before translation and restores it on followup without a fresh download', async () => {
 mocks.stream.mockImplementation(echo); const o = options(); await streamChatAgent(o);
 const previousTools = o.onTools.mock.lastCall[0]; expect(previousTools[0].xArticle.sha256).toBe(source.sha256);
 const restored = normalizeToolResults(previousTools); expect(restored[0].xArticle).toEqual(previousTools[0].xArticle);
 await streamChatAgent(options({ messages: [{ role: 'user', content: '翻译全文' }], previousTools: restored }));
 expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
});
it('honors cancellation between translation batches and leaves an incomplete marker', async () => {
 const controller = new AbortController(); const o = options({ signal: controller.signal });
 mocks.stream.mockImplementation(p => { echo(p); controller.abort(); });
 await expect(translateXArticles([source], url, o)).rejects.toMatchObject({ name: 'AbortError' });
 expect(o.onText.mock.lastCall[0]).toContain('0/2');
});

it('shrinks requests only after a real capacity error and still covers the complete original', async () => {
 const body = Array.from({ length: 25 }, (_, i) => `Paragraph ${i}: original words.`).join('\n\n');
 mocks.stream.mockImplementation(p => {
  const data = JSON.parse(p.messages[0].content);
  if (data.blocks.length > 7) throw new ChatCapacityError('output-limit');
  echo(p);
 });
 const result = await translateXArticles([{ ...source, content: body }], url, options());
 expect(JSON.parse(mocks.stream.mock.calls[0][0].messages[0].content).blocks).toHaveLength(26);
 expect(result).toBe(url + '\n\n## The guide\n\n' + body);
});

it('never retries billing/auth/network failures as smaller paid requests', async () => {
 mocks.stream.mockRejectedValue(new Error('429 quota exceeded'));
 await expect(translateXArticles([source], url, options())).rejects.toThrow('429');
 expect(mocks.stream).toHaveBeenCalledOnce();
});

it('preserves an oversized single paragraph, emoji, URLs and code when capacity forces a split', async () => {
 const body = 'A😀 `code` https://example.org/test sentence. '.repeat(200);
 mocks.stream.mockImplementation(p => {
  const data = JSON.parse(p.messages[0].content);
  if (data.blocks.reduce((n: number, b: any) => n + b.source.length, 0) > 3500) throw new ChatCapacityError('context-limit');
  echo(p);
 });
 const result = await translateXArticles([{ ...source, content: body }], url, options());
 expect(result).toBe((url + '\n\n## The guide\n\n' + body.split('https://example.org/test').join('<https://example.org/test>')).trim());
 expect(result).not.toContain('XKEEP_');
});

it('accepts a valid long translated block beyond the former 15k/100k output ceilings', async () => {
 const body = '译'.repeat(120000);
 mocks.stream.mockImplementation(p => {
  const data = JSON.parse(p.messages[0].content);
  p.onDelta(JSON.stringify({ translations: data.blocks.map((b: any) => ({ id: b.id, text: body })) }));
 });
 expect(await translateXArticles([source], url, options())).toContain(body);
 expect(mocks.stream).toHaveBeenCalledOnce();
});
