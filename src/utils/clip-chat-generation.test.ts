// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ listeners: new Set<() => void>(), generate: vi.fn(), stream: vi.fn(), tool: vi.fn(), xSource: vi.fn(), saves: vi.fn(), histories: [] as any[], models: [] as any[] }));
vi.mock('./storage-utils', () => ({
	generalSettings: { providers: [] }, getLocalStorage: async () => undefined, setLocalStorage: vi.fn(),
}));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'chat', name: 'Chat' }], streamChat: (...args: any[]) => state.stream(...args) }));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
vi.mock('./chat-history', () => ({
	loadConversations: async () => structuredClone(state.histories),
	saveConversation: async (_url: string, _title: string, chat: any) => { state.saves(structuredClone(chat)); state.histories = [structuredClone(chat)]; },
	deleteConversation: vi.fn(),
}));
vi.mock('../write/image-models', async original => ({
	...await original<any>(),
	loadImageModels: async () => ({ models: state.models, defaultId: 'pictures' }),
	generateImage: (...args: any[]) => state.generate(...args),
}));
vi.mock('./chat-tools-client', () => ({ chatCapabilities: async () => ({ web: true, webEnabled: true, webProvider: 'deepseek', images: true, fetch: true }), requestChatTool: (...a: any[]) => state.tool(...a), downloadChatPhoto: async () => new Blob(['search-photo'], { type: 'image/png' }) }));
vi.mock('./x-article-client', () => ({ fetchXArticle: (...args: any[]) => state.xSource(...args), readXArticle: (...args: any[]) => state.xSource(...args), xArticleError: (error: Error) => error.message }));
import { ImageJobRunner } from './image-job-runner';
let runner: ImageJobRunner;
vi.mock('./image-jobs', () => ({
 submitImageJob: async (request: any) => { const config = state.models.find(m => m.id === request.configId); await runner.enqueue({ job: { ...request, created: Date.now(), state: 'queued', modelLabel: 'Images' }, config }); },
 cancelImageJob: async (id: string) => runner.cancel(id),
 watchImageJobs: (fn: () => void) => { state.listeners.add(fn); return () => state.listeners.delete(fn); },
 imageJobLabel: (state: string) => state, openImageLibrary: vi.fn(),
}));
import { readImageJob } from './image-library-store';
import { mountClipChat } from './clip-chat';
import { getChatImage } from './chat-generated-images';
import { parseChatImageReply, startChatImage } from './chat-image-generation';
import { setUiLanguage } from './ui-text';
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const reply = '可以生成这张配图。\n```qm-action\n{"type":"image","prompt":"一只在窗边看书的猫","aspect":"1:1"}\n```';
const config = { id: 'pictures', engine: 'api', sourceId: 'custom', name: 'Images', model: 'image-one', models: ['image-one', 'image-two'], baseUrl: 'https://images.test/v1', apiKey: 'test-key' };
const submit = async (text = '生成一张猫的图片') => {
	document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = text;
	document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); await flush();
};
const button = () => document.querySelector<HTMLButtonElement>('.clip-chat-generated button')!;
let chat: ReturnType<typeof mountClipChat>;
beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory()); state.listeners.clear(); runner = new ImageJobRunner(() => state.listeners.forEach(fn => fn()));
	document.body.replaceChildren(); vi.clearAllMocks(); state.histories = []; state.models = [config]; setUiLanguage('zh_CN');
	vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1024, close() {} })));
	vi.stubGlobal('Blob', NodeBlob);
	URL.createObjectURL = vi.fn(() => 'blob:generated'); URL.revokeObjectURL = vi.fn();
	state.generate.mockResolvedValue(new NodeBlob(['image'], { type: 'image/png' }));
	state.stream.mockImplementation(async (options: any) => { options.onDelta(reply); return reply; });
});
afterEach(() => { chat?.destroy(); vi.unstubAllGlobals(); });
async function mount() {
	chat = mountClipChat({ getContext: () => ({ title: 'Page', markdown: 'Article text', url: 'https://article.test/a' }) });
	chat.toggle(true); await flush();
}

it('sends the complete article, long quote and all conversation turns without fixed clipping', async () => {
	const markdown = 'Article '.repeat(12000) + 'ARTICLE_TAIL';
	const quote = 'Selected '.repeat(700) + 'QUOTE_TAIL';
	const messages = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `HISTORY_${i}` }));
	chat = mountClipChat({ initialConversation: { id: 'long-context', title: 'Long', updatedAt: Date.now(), messages } as any,
		getContext: () => ({ title: 'Long article', markdown, url: 'https://article.test/long' }) });
	chat.toggle(true); await flush(); chat.quote(quote);
	state.stream.mockImplementation(async (o: any) => { o.onDelta('Complete'); return 'Complete'; });
	await submit('请看全文');
	const request = state.stream.mock.calls[0][0];
	expect(request.system).toContain(markdown);
	expect(request.messages).toHaveLength(51);
	expect(request.messages[0].content).toContain('HISTORY_0');
	expect(request.messages[50].content).toContain(quote);
});

it('generates directly from natural-language chat and restores the picture without another request', async () => {
	await mount(); await submit();
	expect(state.stream.mock.calls[0][0].system).toContain('你可以调用已配置的生图模型');
	expect(document.querySelector('.clip-chat-body')!.textContent).not.toContain('qm-action');
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')!.hidden).toBe(false));
	expect(state.generate).toHaveBeenCalledTimes(1);
	expect(button().textContent).toBe('重新生成');
	expect(state.generate.mock.calls[0].slice(0, 3)).toEqual([config, '一只在窗边看书的猫', '1:1']);
	expect(state.generate.mock.calls[0][4]).toBe('image-one');
	const image = state.histories[0].messages[1].generatedImages[0];
	expect(await getChatImage(image.imageId)).toBeDefined();
	expect(JSON.stringify(state.histories)).not.toContain('base64');
	const download = document.querySelector<HTMLAnchorElement>('.clip-chat-generated a')!;
	expect(download.download).toMatch(/\.png$/); expect(download.href).toBe('blob:generated');
	chat.destroy(); await mount();
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')!.hidden).toBe(false));
	expect(state.generate).toHaveBeenCalledTimes(1);
});

it('offers settings for missing configuration and rechecks settings before later questions', async () => {
	state.models = []; await mount(); await submit();
	expect(state.stream.mock.calls[0][0].system).toContain('当前没有配置可用的生图模型');
	expect(button().hidden).toBe(true);
	expect(document.querySelector('.clip-chat-generated')!.textContent).toContain('去添加生图模型');
	state.models = [config]; await submit('现在生成');
	expect(state.stream.mock.calls[1][0].system).toContain('你可以调用已配置的生图模型');
	await vi.waitFor(() => expect(state.histories[0].messages[3].generatedImages[0].imageId).toBeDefined());
});

it('keeps failed generation retryable and does not persist an invalid image', async () => {
	state.generate.mockRejectedValueOnce(new Error('HTTP 429'));
	await mount(); await submit();
	await vi.waitFor(() => expect(document.querySelector('.clip-chat-generated-status')!.textContent).toContain('额度用完'));
	expect(button().textContent).toBe('生成图片');
	expect(state.histories[0].messages[1].generatedImages[0].imageId).toBeUndefined();
	vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Invalid image'));
	button().click(); button().click(); await vi.waitFor(() => expect(document.querySelector('.clip-chat-generated-status')!.textContent).toContain('图片无效'));
	expect(state.generate).toHaveBeenCalledTimes(2);
	expect(state.histories[0].messages[1].generatedImages[0].imageId).toBeUndefined();
});

it('continues generation after sidebar destruction and restores the result without another request', async () => {
 let finish!: (blob: Blob) => void;
 state.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 await mount(); await submit();
 await vi.waitFor(() => expect(state.generate).toHaveBeenCalledTimes(1));
 const signal = state.generate.mock.calls[0][3], jobId = state.histories[0].messages[1].generatedImages[0].jobId;
 chat.destroy(); expect(signal.aborted).toBe(false);
 finish(new Blob(['late'], { type: 'image/png' }));
 await vi.waitFor(async () => expect((await readImageJob(jobId))?.state).toBe('ready'));
 await mount();
 await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')!.hidden).toBe(false));
 expect(state.generate).toHaveBeenCalledTimes(1);
});

it('retains the previous picture on regeneration failure', async () => {
	await mount(); await submit();
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')!.hidden).toBe(false));
	const imageId = state.histories[0].messages[1].generatedImages[0].imageId;
	state.generate.mockRejectedValueOnce(new Error('HTTP 400: rejected'));
	button().click(); await vi.waitFor(() => expect(document.querySelector('.clip-chat-generated-status')!.textContent).toContain('rejected'));
	expect(state.histories[0].messages[1].generatedImages[0].imageId).toBe(imageId);
	expect(await getChatImage(imageId)).toBeDefined();
});

it('waits for the completed reply and never dispatches an aborted stream', async () => {
	let finish!: () => void;
	state.stream.mockImplementation(async (options: any) => {
		options.onDelta(reply);
		await new Promise<void>(resolve => { finish = resolve; });
	});
	await mount(); await submit();
	expect(state.generate).not.toHaveBeenCalled();
	document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); // Stop the current turn.
	finish(); await flush();
	expect(state.generate).not.toHaveBeenCalled();
});

it('uses the conversation for a follow-up image, while ordinary replies do not dispatch', async () => {
	await mount(); await submit();
	await vi.waitFor(() => expect(state.histories[0].messages[1].generatedImages[0].imageId).toBeDefined());
	state.stream.mockImplementation(async (options: any) => { options.onDelta(reply.replace('1:1', '9:16')); });
	await submit('再来一张竖版');
	await vi.waitFor(() => expect(state.histories[0].messages[3].generatedImages[0].imageId).toBeDefined());
	expect(state.generate.mock.calls[1][2]).toBe('9:16');
	expect(state.stream.mock.calls[1][0].messages[1].content).toContain('一只在窗边看书的猫');
	state.stream.mockImplementation(async (options: any) => { options.onDelta('这是提示词说明。'); });
	await submit('先别生图，解释提示词');
	expect(state.generate).toHaveBeenCalledTimes(2);
});

it('does not auto-run old unsubmitted proposals restored from history', async () => {
	state.histories = [{ id: 'old', title: 'Old', messages: [{ role: 'assistant', content: 'Draft', generatedImages: [{ prompt: '旧提示词', aspect: '1:1' }] }] }];
	await mount(); await flush();
	expect(document.querySelector('.clip-chat-generated')).not.toBeNull();
	expect(state.generate).not.toHaveBeenCalled();
});

it('does not dispatch when a reply ends with an incomplete command', async () => {
	state.stream.mockImplementation(async (options: any) => { options.onDelta(reply + '\n```qm-action\n{"type":"image"'); });
	await mount(); await submit();
	expect(state.generate).not.toHaveBeenCalled();
});

it('submits a completed image instruction only once even if dispatch is called twice', async () => {
	const image = { prompt: '一只猫', aspect: '1:1' };
	const persist = vi.fn(async () => {});
	await Promise.all([startChatImage(image, persist), startChatImage(image, persist)]);
	await vi.waitFor(() => expect(state.generate).toHaveBeenCalledTimes(1));
	await startChatImage(image, persist);
	expect(state.generate).toHaveBeenCalledTimes(1);
});

it('holds incomplete commands, ignores non-image operations, and bounds the number of image requests', () => {
	expect(parseChatImageReply('Hello\n```qm-action\n{"type":"image"').text).toBe('Hello');
	expect(parseChatImageReply('```qm-action\n{"type":"insert","markdown":"do not insert"}\n```').images).toEqual([]);
	expect(parseChatImageReply(reply.repeat(10)).images).toHaveLength(4);
	expect(parseChatImageReply('```qm-action\n{"type":"image","prompt":"Cat","aspect":"invalid"}\n```').images[0].aspect).toBe('16:9');
});

it('retains X source code verbatim in the rendered conversation and history without executing quoted image actions', async () => {
 const url = 'https://x.com/poteto/status/2094457600259842065';
 const code = '```text\nbefore\n\n\nafter\n```\n\n```qm-action\n{"type":"image","prompt":"untrusted source example","aspect":"1:1"}\n```';
 state.xSource.mockResolvedValue({ url, title: 'Source guide', author: 'Lauren', content: 'A paragraph.\n\n' + code,
  sha256: 'a'.repeat(64), kind: 'article', provenance: 'x-original-page', complete: true });
 state.stream.mockImplementation(async (o: any) => {
  const input = JSON.parse(o.messages[0].content);
  o.onDelta(JSON.stringify({ translations: input.blocks.map((p: any) => ({ id: p.id, text: p.source.trim() })) }));
 });
 await mount(); await submit('完整翻译 ' + url);
 await vi.waitFor(() => expect(state.histories[0]?.messages[1]?.content).toContain(code));
 expect(document.querySelector('.clip-chat-body pre code')?.textContent).toBe('before\n\n\nafter\n');
 expect(state.histories[0].messages[1].generatedImages).toBeUndefined();
 expect(state.generate).not.toHaveBeenCalled();
 chat.destroy(); await mount();
 expect(document.querySelector('.clip-chat-body pre code')?.textContent).toContain('\n\n\n');
 expect(state.generate).not.toHaveBeenCalled();
});

it('shows searched landscape photos inline without generation and retains them across history restoration', async () => {
 const photo = { id: 'landscape-1', thumb: 'https://images.unsplash.com/one', full: 'https://images.unsplash.com/one', author: 'Photo Author', link: 'https://unsplash.com/photos/one', description: 'Mountain landscape', download: '/photos/one/download' };
 state.tool.mockResolvedValue({ photos: [photo] });
 state.stream.mockImplementationOnce(async (o: any) => o.onDelta('```qm-tool\n{"type":"search_images","query":"landscape scenery","label":"风景"}\n```')).mockImplementationOnce(async (o: any) => o.onDelta('找到这些照片。'));
 await mount(); await submit('帮我找几张风景图');
 await vi.waitFor(() => expect(document.querySelector('.qm-photo-grid img')).not.toBeNull());
 expect(state.generate).not.toHaveBeenCalled(); expect(state.tool.mock.calls[0][0]).toMatchObject({ query: 'landscape scenery', count: 4 });
 expect(state.histories[0].messages[1].tools[0].photos[0].id).toBe(photo.id);
 chat.destroy(); await mount();
 expect(document.querySelector('.qm-photo-credit')?.textContent).toContain('Photo Author'); expect(state.tool).toHaveBeenCalledTimes(1);
});
