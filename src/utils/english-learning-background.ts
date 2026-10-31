import browser from './browser-polyfill';
import { enabledChatModels, streamChat } from './chat-llm';
import { effortOptions } from './chat-thinking';
import { generalSettings, loadSettings } from './storage-utils';
import { ENGLISH_TUTOR_SYSTEM, dictionaryQuery, englishContextSentences, isDictionaryQuery, lookupDictionary, parseEnglishLesson, pronunciationWords, validateEnglishContext, type DictionaryEntry, type EnglishContext, type EnglishLesson } from './english-dictionary';

type Session = { input: EnglishContext; tab?: number; at: number };
const sessions = new Map<string, Session>();
const dictionaryCache = new Map<string, { at: number; value: DictionaryEntry }>();
const lessonCache = new Map<string, { at: number; value: EnglishLesson }>();
const DICTIONARY_CACHE = 'qiaomuEnglishDictionaryCache', LESSON_CACHE = 'qiaomuEnglishLessonCache';
let cacheReady: Promise<void> | undefined;
let cacheWrites = Promise.resolve();
function restoreCaches(): Promise<void> {
	return cacheReady ||= (async () => {
		try {
			const saved = await browser.storage.session.get([DICTIONARY_CACHE, LESSON_CACHE]);
			for (const [key, map, limit, ttl] of [[DICTIONARY_CACHE, dictionaryCache, 64, 86_400_000], [LESSON_CACHE, lessonCache, 24, 1_800_000]] as const) {
				const rows = saved[key];
				if (!Array.isArray(rows)) continue;
				for (const row of rows.slice(-limit)) {
					if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1]?.at !== 'number' || Date.now() - row[1].at >= ttl || !row[1].value) continue;
					map.set(row[0], row[1]);
				}
			}
		} catch { /* Session caching is an optimization; never block a lookup. */ }
	})();
}
function persistCaches() {
	// storage.session survives MV3 worker suspension without saving reading material to disk.
	cacheWrites = cacheWrites.catch(() => {}).then(async () => {
		try { await browser.storage.session.set({ [DICTIONARY_CACHE]: [...dictionaryCache], [LESSON_CACHE]: [...lessonCache] }); } catch { /* memory-only fallback */ }
	});
}
function remember<T>(map: Map<string, { at: number; value: T }>, key: string, value: T, limit: number) {
	map.delete(key); map.set(key, { at: Date.now(), value });
	while (map.size > limit) map.delete(map.keys().next().value!);
}
export function registerEnglishLearning() {
	browser.runtime.onMessage.addListener((raw: any, sender) => {
		if (raw?.action !== 'qiaomuEnglishOpen') return;
		if (sender.id !== browser.runtime.id) return Promise.resolve({ error: 'invalid' });
		const input = validateEnglishContext(raw.input);
		if (!input) return Promise.resolve({ error: 'selection' });
		for (const [key, value] of sessions) if (Date.now() - value.at > 30 * 60_000) sessions.delete(key);
		while (sessions.size >= 24) sessions.delete(sessions.keys().next().value!);
		const token = crypto.randomUUID();
		sessions.set(token, { input, tab: sender.tab?.id, at: Date.now() });
		return Promise.resolve({ token });
	});
	browser.runtime.onConnect.addListener(port => {
		if (port.name !== 'qiaomu-english-learning') return;
		const senderUrl = port.sender?.url || '';
		if (port.sender?.id !== browser.runtime.id || !senderUrl.startsWith(browser.runtime.getURL('english-learning.html') + '#')) { port.disconnect(); return; }
		const token = senderUrl.split('#')[1], session = sessions.get(token);
		if (!session || (session.tab !== undefined && session.tab !== port.sender?.tab?.id)) { port.disconnect(); return; }
		sessions.delete(token); // Single-use capability, not a page-controlled URL/query.
		let closed = false, dictionary: DictionaryEntry | undefined, dictionaryBusy = false, learningBusy = false, cancelled = false;
		let learningController: AbortController | undefined;
		let phoneticsBusy = false;
		const controllers = new Set<AbortController>();
		const send = (data: unknown) => { if (!closed) { try { port.postMessage(data); } catch { /* frame closed */ } } };
		port.onDisconnect.addListener(() => { closed = true; controllers.forEach(c => c.abort()); controllers.clear(); });
		async function lookup() {
			if (dictionaryBusy || !isDictionaryQuery(session!.input.text)) return;
			dictionaryBusy = true;
			const controller = new AbortController(); controllers.add(controller);
			const timer = setTimeout(() => controller.abort(), 12_000);
			try {
				const key = dictionaryQuery(session!.input.text)!, cached = dictionaryCache.get(key);
				dictionary = cached && cached.value.query === key && Date.now() - cached.at < 86_400_000 ? cached.value : await lookupDictionary(key, controller.signal);
				if (dictionary.meanings.length) { remember(dictionaryCache, key, dictionary, 64); persistCaches(); }
				send({ type: 'dictionary', value: dictionary });
			} catch { send({ type: 'error', stage: 'dictionary' }); }
			finally { clearTimeout(timer); controllers.delete(controller); dictionaryBusy = false; }
		}
		async function learn() {
			if (learningBusy) return;
			learningBusy = true; cancelled = false;
			const controller = new AbortController(); controllers.add(controller);
			learningController = controller;
			const timer = setTimeout(() => controller.abort(), 240_000);
			try {
				await loadSettings();
				// Read the shared selection for every request, including cards already open.
				const saved = await browser.storage.local.get('qiaomuChatModel'), models = enabledChatModels();
				const model = models.find(item => item.id === saved.qiaomuChatModel) || models[0];
				if (!model) throw new Error('model');
				const provider = generalSettings.providers.find(p => p.id === model.providerId);
				const efforts = effortOptions(model, provider), reasoningEffort = efforts.includes('high') ? 'high' : efforts.filter(e => !['none', 'off', 'disabled'].includes(e)).slice(-1)[0];
				const key = JSON.stringify(['context-v4', model.id, model.providerModelId, provider?.baseUrl, session!.input.text, session!.input.context, session!.input.title]);
				const cached = lessonCache.get(key);
				if (cached && Date.now() - cached.at < 30 * 60_000) { send({ type: 'lesson', value: cached.value, cached: true }); return; }
				send({ type: 'thinking', effort: reasoningEffort || '' });
				let output = '';
				const contextSentences = englishContextSentences(session!.input.context);
				await streamChat({ model, system: ENGLISH_TUTOR_SYSTEM, messages: [{ role: 'user', content: JSON.stringify({ selected: session!.input.text, context: session!.input.context, contextSentences, title: session!.input.title, dictionary: dictionary ? { word: dictionary.word, meanings: dictionary.meanings, uk: dictionary.uk, us: dictionary.us } : null }) }], reasoningEffort, nativeTools: false, signal: controller.signal, onDelta: delta => { output += delta; if (output.length > 40_000) controller.abort(); }, onThought: () => {} });
				if (controller.signal.aborted) throw new Error('aborted');
				const value = parseEnglishLesson(output, Boolean(session!.input.context.trim()), contextSentences.length);
				remember(lessonCache, key, value, 24); persistCaches(); send({ type: 'lesson', value, cached: false });
			} catch { if (!closed) send(cancelled ? { type: 'cancelled' } : { type: 'error', stage: 'learning' }); }
			finally { clearTimeout(timer); controllers.delete(controller); learningBusy = false; learningController = undefined; }
		}
		let initialized = false;
		port.onMessage.addListener(async (request: any) => {
			if (request?.type === 'init' && !initialized) {
				initialized = true;
				try {
					await restoreCaches();
					await loadSettings();
					const saved = await browser.storage.local.get(['qiaomuChatModel', 'language']);
					const models = enabledChatModels().map(m => ({ id: m.id, name: m.name || m.providerModelId, thinking: effortOptions(m, generalSettings.providers.find(p => p.id === m.providerId)).length > 0 }));
					send({ type: 'init', input: session!.input, models, selected: saved.qiaomuChatModel, language: saved.language, dictionaryQuery: isDictionaryQuery(session!.input.text) });
					if (!closed) void lookup();
				} catch { send({ type: 'error', stage: 'init' }); }
			} else if (initialized && request?.type === 'dictionary') void lookup();
			else if (initialized && request?.type === 'phonetics' && !phoneticsBusy && Number.isInteger(request.offset) && request.offset >= 0) {
				const words = pronunciationWords(session!.input.text), offset = request.offset as number;
				if (offset >= words.length) return;
				phoneticsBusy = true;
				const controller = new AbortController(); controllers.add(controller);
				const timer = setTimeout(() => controller.abort(), 20_000);
				try {
					const results: Array<{ word: string; uk: string; us: string }> = [];
					// Deliberately small batches, requested only when the learner opens word IPA.
					for (const word of words.slice(offset, offset + 8)) {
						if (controller.signal.aborted) break;
						const cached = dictionaryCache.get(word);
						const entry = cached && cached.value.query === word && Date.now() - cached.at < 86_400_000 ? cached.value : await lookupDictionary(word, controller.signal);
						if (entry.meanings.length) remember(dictionaryCache, word, entry, 64);
						results.push({ word, uk: entry.uk, us: entry.us });
					}
					if (controller.signal.aborted) throw new Error('timeout');
					persistCaches(); send({ type: 'phonetics', values: results, next: offset + results.length, total: words.length });
				} catch { send({ type: 'error', stage: 'phonetics' }); }
				finally { clearTimeout(timer); controllers.delete(controller); phoneticsBusy = false; }
			}
			else if (initialized && request?.type === 'learn') void learn();
			else if (request?.type === 'cancel') { cancelled = true; learningController?.abort(); }
		});
	});
}
