import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), tool: vi.fn() }));
vi.mock('./chat-llm', () => ({ streamChat: (...a: any[]) => state.stream(...a) }));
vi.mock('./chat-tools-client', () => ({ requestChatTool: (...a: any[]) => state.tool(...a), chatCapabilities: vi.fn() }));
import { streamChatAgent, preferImageSearch, chatToolInstructions } from './chat-agent';
import { normalizeChatTool, normalizeToolResults, parseChatTools, publicWebUrl, type ChatToolResult } from './chat-tools-types';
const capabilities = { web: true, webEnabled: true, webProvider: 'deepseek', images: true, fetch: true };
const photo = { id: 'photo-2', thumb: 'https://images.unsplash.com/a', full: 'https://images.unsplash.com/a', link: 'https://unsplash.com/photos/a', author: 'A', description: 'Mountain', download: '/photos/a/download' };
const tool = (call: any) => '```qm-tool\n' + JSON.stringify(call) + '\n```';
const image = '```qm-action\n{"type":"image","prompt":"山水风景","aspect":"16:9"}\n```';
const answer = (text: string) => async (o: any) => { o.onDelta(text); };
function run(question: string, extra: any = {}) {
 const onText = vi.fn(), onTools = vi.fn();
 const promise = streamChatAgent({ model: {} as any, system: '当前文章：旅行', messages: [{ role: 'user', content: question }], capabilities, onText, onTools, ...extra });
 return { promise, onText, onTools };
}
beforeEach(() => { vi.clearAllMocks(); state.tool.mockResolvedValue({ photos: [photo] }); });
it('uses real native tool events without requiring or calling the separate search service', async () => {
 const native = { id: 'native', call: { type: 'provider_tool', tool: 'web_search', label: 'news' }, state: 'done', sources: [{ title: 'Source', url: 'https://example.com/', snippet: '' }] };
 state.stream.mockImplementationOnce(async (o: any) => { expect(o.nativeTools).toBe(true); expect(o.system).not.toContain('尚未连接'); o.onNativeTools([native]); o.onDelta('Found'); });
 const result = run('Find news', { capabilities: { web: true, webEnabled: true, webProvider: 'Token Plan', images: false, fetch: true, native: ['web_search', 'code_interpreter'] } });
 expect(await result.promise).toBe('Found'); expect(result.onTools).toHaveBeenCalledWith([native]); expect(state.tool).not.toHaveBeenCalled();
});
it('repairs the reported find-landscape request before a mistaken image action can reach generation', async () => {
 state.stream.mockImplementationOnce(answer(image)).mockImplementationOnce(answer(tool({ type: 'search_images', query: 'landscape scenery', label: '风景' }))).mockImplementationOnce(answer('找到这些风景照片。'));
 const r = run('帮我找几张风景图'); await r.promise;
 expect(state.stream).toHaveBeenCalledTimes(3);
 expect(state.tool).toHaveBeenCalledTimes(1);
 expect(state.tool.mock.calls[0][0]).toEqual({ type: 'search_images', query: 'landscape scenery', label: '风景', count: 4, page: 1, orientation: '', color: '' });
 expect(r.onText.mock.lastCall![0]).not.toContain('qm-action');
 expect(r.onTools.mock.lastCall![0][0].photos).toEqual([photo]);
 expect(state.stream.mock.calls[2][0].messages.at(-1).content).toContain('photo-2');
});
it('corrects Chinese tool queries without sending them to Unsplash', async () => {
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_images', query: '石头', count: 4 }))).mockImplementationOnce(answer(tool({ type: 'search_images', query: 'rocks stones', count: 4 }))).mockImplementationOnce(answer('已找到。'));
 const r = run('找几张石头的照片'); await r.promise;
 expect(state.tool).toHaveBeenCalledTimes(1); expect(state.tool.mock.calls[0][0].query).toBe('rocks stones');
 expect(r.onTools.mock.lastCall![0][0].error).toBe('english-image-query-required');
});
it('keeps explicit creation available but defaults 配图 and follow-up search filters to search', () => {
 expect(preferImageSearch('生成一张风景图')).toBe(false);
 expect(preferImageSearch('不要生成，帮我找风景图')).toBe(true);
 expect(preferImageSearch('给文章配图')).toBe(true);
 expect(preferImageSearch('draw a landscape image')).toBe(false);
 expect(preferImageSearch('换一批', [{ call: { type: 'search_images' }, photos: [photo] } as any])).toBe(true);
 expect(chatToolInstructions(capabilities, true)).toContain('page+1');
});
it('supports popular photos without a topic and preserves follow-up filters', async () => {
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_images' }))).mockImplementationOnce(answer('热门照片。'));
 await run('找几张图').promise; expect(state.tool.mock.calls[0][0]).toMatchObject({ query: '', count: 4 });
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_images', query: 'landscape scenery', page: 2, orientation: 'landscape', color: 'black_and_white' }))).mockImplementationOnce(answer('下一批。'));
 await run('换一批').promise; expect(state.tool.mock.lastCall![0]).toMatchObject({ page: 2, orientation: 'landscape', color: 'black_and_white' });
});
it('does not fall back to creation when Unsplash is unconfigured', async () => {
 state.tool.mockRejectedValue(new Error('unsplash-unconfigured'));
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_images', query: 'nature' }))).mockImplementationOnce(answer(image)).mockImplementationOnce(answer('连接 Unsplash 后继续。'));
 const r = run('帮我找几张风景图'); await r.promise;
 expect(r.onTools.mock.lastCall![0][0].error).toBe('unsplash-unconfigured');
 expect(r.onText.mock.lastCall![0]).not.toContain('qm-action');
});
it('searches, reads a real returned URL, then supplies evidence to the current model', async () => {
 state.tool.mockResolvedValueOnce({ sources: [{ title: 'Original', url: 'https://example.com/story', snippet: 'summary' }] }).mockResolvedValueOnce({ sources: [{ title: 'Original', url: 'https://example.com/story', snippet: 'body', content: 'VERIFIED BODY' }] });
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_web', query: 'new development' }))).mockImplementationOnce(answer(tool({ type: 'read_web', url: 'https://example.com/story' }))).mockImplementationOnce(answer('[来源](https://example.com/story)'));
 const r = run('查找最新资料'); await r.promise;
 expect(state.tool).toHaveBeenCalledTimes(2); expect(state.stream.mock.calls[2][0].messages.at(-1).content).toContain('VERIFIED BODY');
 expect(r.onText.mock.lastCall![0]).toContain('https://example.com/story');
});
it('uses an actual displayed photo id and refuses fabricated selections', async () => {
 const onUseImage = vi.fn(); const previousTools = [{ id: 'old', state: 'done', call: { type: 'search_images', query: 'mountains' }, photos: [photo] }] as ChatToolResult[];
 state.stream.mockImplementationOnce(answer(tool({ type: 'use_image', id: photo.id, action: 'insert' }))).mockImplementationOnce(answer('已插入。'));
 await run('用第二张', { previousTools, onUseImage, canInsert: true }).promise;
 expect(onUseImage).toHaveBeenCalledWith(photo, 'insert'); expect(state.tool).not.toHaveBeenCalled();
 state.stream.mockImplementationOnce(answer(tool({ type: 'use_image', id: 'invented', action: 'insert' }))).mockImplementationOnce(answer('请选择图片。'));
 const r = run('用第二张', { previousTools, onUseImage, canInsert: true }); await r.promise;
 expect(onUseImage).toHaveBeenCalledTimes(1); expect(r.onTools.mock.lastCall![0][0].state).toBe('error');
});
it('aborts late results and does not execute incomplete tools or disabled web search', async () => {
 const c = new AbortController(); state.stream.mockImplementationOnce(answer(tool({ type: 'search_images', query: 'landscape' })));
 state.tool.mockImplementationOnce(async () => { c.abort(); throw new DOMException('Aborted', 'AbortError'); });
 await expect(run('找风景图', { signal: c.signal }).promise).rejects.toMatchObject({ name: 'AbortError' });
 expect(state.stream).toHaveBeenCalledTimes(1);
 state.stream.mockImplementationOnce(answer('```qm-tool\n{"type":"search_images"'));
 await run('找图').promise; expect(state.tool).toHaveBeenCalledTimes(1);
 state.stream.mockImplementationOnce(answer(tool({ type: 'search_web', query: 'news' }))).mockImplementationOnce(answer('联网已关闭。'));
 await run('查资料', { capabilities: { ...capabilities, webEnabled: false } }).promise; expect(state.tool).toHaveBeenCalledTimes(1);
});
it('bounds repeated calls and discards secret or oversized persistence fields', async () => {
 state.stream.mockImplementation(answer(tool({ type: 'search_web', query: 'same' })));
 await run('查资料').promise; expect(state.stream).toHaveBeenCalledTimes(5); expect(state.tool).toHaveBeenCalledTimes(1);
 const [saved] = normalizeToolResults([{ id: 'x', call: { type: 'search_images' }, state: 'running', apiKey: 'SECRET', photos: [photo], content: 'SECRET' }]);
 expect(saved.state).toBe('error'); expect(saved.error).toBe('interrupted'); expect(JSON.stringify(saved)).not.toContain('SECRET');
});
it('validates public URLs and tolerates malformed tool blocks without executing them', () => {
 for (const url of ['file:///tmp/a', 'http://127.0.0.1/', 'http://localhost/', 'http://host.local/', 'http://[::1]/', 'https://user:pass@example.com/']) expect(publicWebUrl(url)).toBe('');
 expect(normalizeChatTool({ type: 'read_web', url: 'http://192.168.1.1/' })).toBeUndefined();
 expect(parseChatTools('hello\n```qm-tool\ninvalid\n```').calls).toEqual([]);
});
it('never displays raw internal tool syntax when the model returns a malformed or unsupported call', async () => {
 state.stream.mockImplementationOnce(answer('```qm-tool\n{"type":"not_supported"}\n```'));
 const r = run('帮我找图片'); await r.promise;
 expect(state.tool).not.toHaveBeenCalled(); expect(r.onText.mock.lastCall![0]).not.toContain('qm-tool'); expect(r.onText.mock.lastCall![0]).toContain('重试');
});
