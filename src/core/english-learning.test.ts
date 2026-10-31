// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';

let receive: (message: any) => void, disconnect: () => void;
let post: ReturnType<typeof vi.fn>;
const input = { text: 'US', context: 'The US imports goods from us.', title: 'Example' };
const value = { query: 'US', word: 'US', uk: 'juː es', us: 'juː es', meanings: [{ pos: 'abbr.', text: '美国' }], examples: [{ en: 'An example.', zh: '例句。' }], forms: [], url: 'https://dict.youdao.com/result?word=US' };
const click = (label: string) => { const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label); expect(target).toBeDefined(); target!.click(); };

beforeEach(async () => {
	vi.resetModules(); document.body.innerHTML = '<main id="learning" aria-busy="true"></main>'; post = vi.fn();
	vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() });
	vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
	vi.stubGlobal('chrome', { runtime: { connect: () => ({ postMessage: post, disconnect: vi.fn(), onMessage: { addListener: (handler: any) => receive = handler }, onDisconnect: { addListener: (handler: any) => disconnect = handler } }), openOptionsPage: vi.fn() } });
	await import('./english-learning');
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.useRealTimers(); vi.unstubAllGlobals(); });
const init = (dictionaryQuery = true) => receive({ type: 'init', language: 'zh_CN', input, dictionaryQuery, models: [{ id: 'm', name: 'Saved model', thinking: true }], selected: 'm' });

it('keeps standard lookup free of model requests and renders all requested learning sections only on demand', () => {
	init(); receive({ type: 'dictionary', value });
	expect(post.mock.calls.filter(([m]) => m.type === 'learn')).toHaveLength(0);
	expect(document.body.textContent).toContain('abbr. 缩写'); expect(document.body.textContent).toContain('美国');
	click('深入学习'); expect(post).toHaveBeenLastCalledWith({ type: 'learn' });
	receive({ type: 'lesson', cached: false, value: { translation: '译义', contextual: '语境', grammar: '用法', examples: '教学例句', memory: '<img src=x onerror=alert(1)>联想', pronunciation: '发音提示内容' } });
	expect(Array.from(document.querySelectorAll('.lesson h2')).map(n => n.textContent)).toEqual(['常规译义', '放进上下文', '语法与用法', '拓展例句', '这样记住它', '发音提示']);
	expect(document.querySelector('.lesson img')).toBeNull(); expect(document.querySelector('.lesson')!.textContent).toContain('<img');
});

it('makes one automatic sentence request and supports stopping, retrying, and expired-session feedback', () => {
	init(false); expect(post.mock.calls.filter(([m]) => m.type === 'learn')).toHaveLength(1);
	click('停止'); expect(post).toHaveBeenLastCalledWith({ type: 'cancel' });
	receive({ type: 'cancelled' }); click('深入学习'); receive({ type: 'error', stage: 'learning' });
	expect(document.body.textContent).toContain('讲解失败'); click('重试');
	expect(post.mock.calls.filter(([m]) => m.type === 'learn')).toHaveLength(3);
	disconnect(); expect(document.body.textContent).toContain('学习卡已失效'); expect(document.querySelector<HTMLButtonElement>('.primary')!.disabled).toBe(true);
});

it('only requests word phonetics when expanded and keeps uppercase and lowercase results distinct', () => {
	init(false); const details = document.querySelector<HTMLDetailsElement>('.word-ipa')!;
	expect(post.mock.calls.some(([m]) => m.type === 'phonetics')).toBe(false);
	details.open = true; details.dispatchEvent(new Event('toggle')); expect(post).toHaveBeenLastCalledWith({ type: 'phonetics', offset: 0 });
	receive({ type: 'phonetics', values: [{ word: 'US', uk: 'juː es', us: 'juː es' }, { word: 'us', uk: 'ʌs', us: 'ʌs' }], next: 2, total: 2 });
	expect(Array.from(document.querySelectorAll('.ipa-row strong')).map(n => n.textContent)).toEqual(['US', 'us']);
	expect(document.querySelector('.word-ipa')!.textContent).toContain('/ʌs/');
});

it('keeps dictionary details beside their source and preserves all six complete lesson fields', () => {
	init(); receive({ type: 'dictionary', value: { ...value, forms: [{ name: '复数', value: 'examples' }] } });
	const dictionaryDetails = document.querySelector('.dictionary-details')!;
	expect(dictionaryDetails.compareDocumentPosition(document.querySelector('.learning-controls')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	expect(document.querySelector('.forms-list')!.textContent).toContain('复数examples');
	const field = '语境不足时不能推断。English examples must stay complete. '.repeat(80);
	const lesson = { translation: field, contextual: field, grammar: field, examples: 'She stayed resilient. 她依然坚韧。\nHe tried again. 他再次尝试。', memory: field, pronunciation: field };
	receive({ type: 'lesson', cached: true, value: lesson });
	for (const [key, text] of Object.entries(lesson)) {
		const part = document.querySelector('.lesson-' + key)!;
		expect(Array.from(part.querySelectorAll('p')).map(p => p.textContent).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
		expect(part.closest('details')).toBeNull();
	}
	expect(document.querySelector('.provenance')!.textContent).toContain('AI 学习讲解');
	expect(document.querySelectorAll('.lesson-examples .example')).toHaveLength(2);
});

it('translates the full context on expansion with the shared chat model and marks the selected term in examples', () => {
	init(); receive({ type: 'dictionary', value: { ...value, examples: [{ en: 'The US imports goods from us.', zh: '美国从我们这里进口商品。' }] } });
	expect(document.querySelector('select, .model-settings')).toBeNull();
	expect(document.body.textContent).toContain('翻译与讲解跟随 AI 对话模型。');
	expect(Array.from(document.querySelectorAll('.dictionary-examples mark')).map(n => n.textContent)).toEqual(['US']);
	const context = document.querySelector<HTMLDetailsElement>('.context')!;
	context.open = true; context.dispatchEvent(new Event('toggle'));
	expect(post).toHaveBeenLastCalledWith({ type: 'learn' });
	context.dispatchEvent(new Event('toggle'));
	expect(post.mock.calls.filter(([m]) => m.type === 'learn')).toHaveLength(1);
	const full = '美国从我们这里进口商品。不能把 US 和 us 混为一谈。';
	receive({ type: 'lesson', cached: false, value: { contextTranslation: full, translation: '美国', contextual: '这里指美国。', grammar: '用法', examples: 'The US imports goods from us. 美国从我们这里进口商品。', memory: '记忆', pronunciation: '发音' } });
	expect(document.querySelector('.context-translation')!.textContent).toContain(full);
	expect(document.querySelector('.context-original')!.textContent).toBe(input.context);
	expect(Array.from(document.querySelectorAll('.lesson-examples mark')).map(n => n.textContent)).toEqual(['US']);
});

it('shows the complete context translation when the whole context is selected', () => {
	const sentence = 'Small routines make us resilient. Even after a difficult week, we can recover.';
	receive({ type: 'init', language: 'zh_CN', input: { ...input, text: sentence, context: sentence }, dictionaryQuery: false, models: [{ id: 'm', name: 'Saved model', thinking: true }], selected: 'm' });
	const translations = ['日常的小习惯让我们更有韧性。', '即使经历了艰难的一周，我们也能恢复。'];
	receive({ type: 'lesson', cached: false, value: { contextTranslation: translations.join('\n'), contextTranslations: translations, translation: '常规译义', contextual: '语境分析', grammar: '语法', examples: '教学例句', memory: '记忆', pronunciation: '发音' } });
	expect(Array.from(document.querySelectorAll('.context-original')).map(p => p.textContent).join('')).toBe(sentence);
	const pairs = Array.from(document.querySelectorAll('.context-pair'));
	expect(pairs).toHaveLength(2);
	expect(pairs.map(pair => Array.from(pair.children).map(p => p.textContent))).toEqual([
		['Small routines make us resilient. ', translations[0]],
		['Even after a difficult week, we can recover.', translations[1]],
	]);
	expect(document.querySelector('.context-translation-label')).toBeNull();
	expect(document.querySelectorAll('.lesson-section')).toHaveLength(6);
	expect(post.mock.calls.filter(([m]) => m.type === 'learn')).toHaveLength(1);
});

it('recovers visibly when the worker never replies', () => {
	vi.useFakeTimers(); init(); click('深入学习');
	vi.advanceTimersByTime(249_999); expect(document.querySelector('.primary')!.textContent).toBe('停止');
	vi.advanceTimersByTime(1); expect(document.querySelector('.lesson')!.textContent).toContain('学习卡已失效');
	expect(document.querySelector<HTMLButtonElement>('.primary')!.disabled).toBe(true);
	receive({ type: 'lesson', value: { translation: 'late', contextual: 'late', grammar: 'late', examples: 'late', memory: 'late', pronunciation: 'late' } });
	expect(document.querySelector('.lesson')!.textContent).not.toContain('late');
});

it('expires an unacknowledged stop after five seconds without accepting a late result', () => {
	vi.useFakeTimers(); init(); click('深入学习'); click('停止');
	vi.advanceTimersByTime(5_000); expect(document.querySelector('.lesson')!.textContent).toContain('学习卡已失效');
	expect(document.querySelector('.context-content')!.textContent).toContain('学习卡已失效');
	expect(document.querySelector('.context-original')!.textContent).toBe(input.context);
	expect(document.querySelector('.lesson')!.getAttribute('aria-busy')).toBe('false');
});

it('shows recovery immediately if posting to the connection fails', () => {
	init(); post.mockImplementation(() => { throw new Error('Disconnected port'); });
	expect(() => click('深入学习')).not.toThrow();
	expect(document.querySelector('.lesson')!.textContent).toContain('学习卡已失效');
});

it('keeps dictionary and phonetic retry controls from using an expired connection', () => {
	vi.useFakeTimers(); init(false); receive({ type: 'error', stage: 'dictionary' });
	const retry = document.querySelector<HTMLButtonElement>('.dictionary button')!;
	vi.advanceTimersByTime(250_000);
	expect(retry.disabled).toBe(true);
	const before = post.mock.calls.length;
	// Exercise the retained handler as well as native disabled-button behavior.
	retry.onclick!(new MouseEvent('click'));
	const details = document.querySelector<HTMLDetailsElement>('.word-ipa')!; details.open = true; details.dispatchEvent(new Event('toggle'));
	expect(post.mock.calls.length).toBe(before);
	expect(details.textContent).toContain('学习卡已失效');
	expect(document.querySelector<HTMLButtonElement>('.pronunciation')!.disabled).toBe(false);
});
