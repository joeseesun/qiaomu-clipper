import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ messages: [] as any[], connects: [] as any[], lookup: vi.fn(), stream: vi.fn(), storage: vi.fn(), sessionGet: vi.fn(), sessionSet: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { id: 'test', getURL: (p: string) => 'chrome-extension://test/' + p, onMessage: { addListener: (f: any) => mocks.messages.push(f) }, onConnect: { addListener: (f: any) => mocks.connects.push(f) } }, storage: { local: { get: mocks.storage }, session: { get: mocks.sessionGet, set: mocks.sessionSet } } } }));
vi.mock('./storage-utils', () => ({ loadSettings: async () => {}, generalSettings: { providers: [{ id: 'p', name: 'Example', baseUrl: 'https://example.com' }] } }));
vi.mock('./chat-thinking', () => ({ effortOptions: () => ['low', 'medium', 'high'] }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'm', providerId: 'p', providerModelId: 'model', name: 'Model' }, { id: 'm2', providerId: 'p', providerModelId: 'model-two', name: 'Second model' }], streamChat: mocks.stream }));
vi.mock('./english-dictionary', async importOriginal => ({ ...await importOriginal<typeof import('./english-dictionary')>(), lookupDictionary: mocks.lookup }));
import { registerEnglishLearning } from './english-learning-background';
registerEnglishLearning();
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
async function connect(text = 'resilient') {
	const { token } = await mocks.messages[mocks.messages.length - 1]({ action: 'qiaomuEnglishOpen', input: { text, context: 'She remained ' + text, title: 'Test' } }, { id: 'test', tab: { id: 17 } });
	const incoming: any[] = [], disconnects: any[] = [], sent: any[] = [];
	const port = { name: 'qiaomu-english-learning', sender: { id: 'test', url: 'chrome-extension://test/english-learning.html#' + token, tab: { id: 17 } }, postMessage: (m: any) => sent.push(m), disconnect: vi.fn(), onMessage: { addListener: (f: any) => incoming.push(f) }, onDisconnect: { addListener: (f: any) => disconnects.push(f) } };
	mocks.connects[mocks.connects.length - 1](port); await incoming[0]({ type: 'init' }); await flush();
	return { port, send: incoming[0], close: () => disconnects[0](), sent };
}
describe('English learning background', () => {
	beforeEach(() => { mocks.sessionGet.mockResolvedValue({}); mocks.sessionSet.mockReset().mockResolvedValue(undefined); mocks.stream.mockReset(); mocks.lookup.mockReset().mockImplementation(async query => ({ query, word: query, uk: 'r', us: 'r', meanings: [{ pos: 'adj.', text: '有韧性的' }], examples: [], forms: [], url: 'https://dict.youdao.com' })); mocks.storage.mockResolvedValue({ qiaomuChatModel: 'm', language: 'zh_CN' }); });
	it('opening and retrying the dictionary never invokes an LLM', async () => { const p = await connect(); expect(p.sent.some(m => m.type === 'dictionary')).toBe(true); expect(mocks.stream).not.toHaveBeenCalled(); await p.send({ type: 'dictionary' }); await flush(); expect(mocks.stream).not.toHaveBeenCalled(); p.close(); });
	it('does not reuse an uppercase abbreviation as a different lowercase word', async () => {
		const first = await connect('US'); first.close(); const second = await connect('us'); second.close();
		expect(mocks.lookup.mock.calls.map(call => call[0])).toEqual(['US', 'us']); expect(mocks.stream).not.toHaveBeenCalled();
	});
	it('normalizes incidental punctuation before fetching and shares that exact-case dictionary cache', async () => {
		const first = await connect('“coherent,”'); first.close(); const second = await connect('coherent'); second.close();
		expect(mocks.lookup.mock.calls.map(call => call[0])).toEqual(['coherent']); expect(mocks.stream).not.toHaveBeenCalled();
	});
	it('only explicit learning uses the saved provider with high reasoning, no native tools, and reuses completed work', async () => {
		mocks.stream.mockImplementation(async options => options.onDelta(JSON.stringify({ contextTranslations: ['她保持了韧性。'], translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' })));
		const p = await connect('robust'); await p.send({ type: 'learn', model: 'm' }); await flush();
		expect(mocks.stream).toHaveBeenCalledTimes(1); expect(mocks.stream.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'high', nativeTools: false }); expect(p.sent[p.sent.length - 1]?.type).toBe('lesson');
		await p.send({ type: 'learn', model: 'm' }); await flush(); expect(mocks.stream).toHaveBeenCalledTimes(1); expect(p.sent[p.sent.length - 1]?.cached).toBe(true); p.close();
	});
	it('closing aborts in-flight learning and prevents late results', async () => {
		let signal: AbortSignal | undefined; mocks.stream.mockImplementation(options => new Promise((_resolve, reject) => { signal = options.signal; options.signal.addEventListener('abort', () => reject(new Error('abort'))); }));
		const p = await connect('steadfast'); await p.send({ type: 'learn', model: 'm' }); await flush(); p.close(); await flush(); expect(signal?.aborted).toBe(true); expect(p.sent.some(m => m.type === 'lesson')).toBe(false);
	});
	it('gives the tutor the retrieved UK and US pronunciations rather than only meanings', async () => {
		mocks.lookup.mockResolvedValue({ query: 'grounded', word: 'grounded', uk: 'ˈɡraʊndɪd', us: 'ˈɡraʊndɪd', meanings: [{ pos: 'adj.', text: '脚踏实地的' }], examples: [], forms: [], url: 'https://dict.youdao.com' });
		mocks.stream.mockImplementation(async options => options.onDelta(JSON.stringify({ contextTranslations: ['她仍然脚踏实地。'], translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' })));
		const p = await connect('grounded'); await p.send({ type: 'learn' }); await flush();
		expect(JSON.parse(mocks.stream.mock.calls[0][0].messages[0].content).dictionary).toEqual({ word: 'grounded', meanings: [{ pos: 'adj.', text: '脚踏实地的' }], uk: 'ˈɡraʊndɪd', us: 'ˈɡraʊndɪd' });
		p.close();
	});
	it('follows a changed AI chat selection even when a card supplies a stale model id', async () => {
		mocks.stream.mockImplementation(async options => options.onDelta(JSON.stringify({ contextTranslations: ['完整上下文译文。'], translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' })));
		const p = await connect('adaptable');
		mocks.storage.mockResolvedValue({ qiaomuChatModel: 'm2', language: 'zh_CN' });
		await p.send({ type: 'learn', model: 'm' }); await flush();
		expect(mocks.stream.mock.calls[0][0].model.id).toBe('m2');
		expect(JSON.parse(mocks.stream.mock.calls[0][0].messages[0].content)).toMatchObject({ context: 'She remained adaptable', contextSentences: ['She remained adaptable'] });
		expect(p.sent[p.sent.length - 1]).toMatchObject({ type: 'lesson', value: { contextTranslation: '完整上下文译文。' } });
		p.close();
	});
	it('does not accept a contextual explanation in place of the complete context translation', async () => {
		mocks.stream.mockImplementation(async options => options.onDelta(JSON.stringify({ translation: 't', contextual: '片段说明', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' })));
		const p = await connect('unabridged'); await p.send({ type: 'learn' }); await flush();
		expect(p.sent[p.sent.length - 1]).toEqual({ type: 'error', stage: 'learning' });
		expect(p.sent.some(message => message.type === 'lesson')).toBe(false); p.close();
	});
	it('rejects a page claiming to be the learning frame and rejects a capability used by another tab', async () => {
		const token = (await mocks.messages[mocks.messages.length - 1]({ action: 'qiaomuEnglishOpen', input: { text: 'hello', context: '', title: '' } }, { id: 'test', tab: { id: 4 } })).token;
		for (const sender of [{ id: 'test', url: 'https://evil.test/#' + token, tab: { id: 4 } }, { id: 'test', url: 'chrome-extension://test/english-learning.html#' + token, tab: { id: 8 } }]) { const port = { name: 'qiaomu-english-learning', sender, disconnect: vi.fn() }; mocks.connects[mocks.connects.length - 1](port); expect(port.disconnect).toHaveBeenCalled(); }
	});
});

it('reuses completed learning after the MV3 worker has been recreated', async () => {
 const value = { contextTranslations: ['她保持了韧性。'], translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' };
 mocks.stream.mockImplementation(async options => options.onDelta(JSON.stringify(value)));
 const first = await connect('durable'); await first.send({ type: 'learn', model: 'm' }); await flush(); first.close();
 const saved = mocks.sessionSet.mock.calls[mocks.sessionSet.mock.calls.length - 1][0];
 expect(saved.qiaomuEnglishLessonCache.length).toBeGreaterThan(0);
 mocks.sessionGet.mockResolvedValue(saved); vi.resetModules();
 (await import('./english-learning-background')).registerEnglishLearning();
 const second = await connect('durable'); await second.send({ type: 'learn', model: 'm' }); await flush();
 expect(mocks.stream).toHaveBeenCalledTimes(1); expect(second.sent[second.sent.length - 1]).toMatchObject({ type: 'lesson', cached: true }); second.close();
});
