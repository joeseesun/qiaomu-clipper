import { createElement, Volume2, X, ArrowUpRight, BookOpen } from 'lucide';
import { appendLearningText, appendStudyText } from '../utils/english-presentation';
import { englishText, type EnglishLabel } from '../utils/english-ui';
import { englishContextSentences, pronunciationUrl, type DictionaryEntry, type EnglishContext, type EnglishLesson } from '../utils/english-dictionary';
import { englishVoice } from '../utils/english-speech';

const root = document.getElementById('learning')!;
const token = location.hash.slice(1);
let l = englishText(), input: EnglishContext, dictionary: DictionaryEntry | undefined;
let models: Array<{ id: string; name: string; thinking: boolean }> = [], model: string | undefined;
let audio: HTMLAudioElement | undefined, lesson: EnglishLesson | undefined, busy = false, closed = false, ready = false;
let connectionExpired = false, responseTimer: number | undefined;
let utterance: SpeechSynthesisUtterance | undefined;
// Prime the asynchronous voice inventory before the first pronunciation click.
void speechSynthesis.getVoices();
const port = chrome.runtime.connect({ name: 'qiaomu-english-learning' });
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
const button = (label: string, action: () => void, className = '') => { const element = node('button', label, className); element.type = 'button'; element.onclick = action; return element; };
const sendParent = (data: object) => parent.postMessage({ ...data, token }, '*');
const close = () => { if (closed) return; closed = true; window.clearTimeout(responseTimer); audio?.pause(); speechSynthesis.cancel(); port.disconnect(); clearInterval(heartbeat); sendParent({ type: 'close' }); };
const header = node('header'), heading = node('h1', l('title')), closeButton = button('', close, 'icon-button');
closeButton.setAttribute('aria-label', l('close')); closeButton.append(createElement(X));
const titleGroup = node('div', '', 'card-title'); titleGroup.append(createElement(BookOpen), heading); header.append(titleGroup, closeButton); root.append(header);
const body = node('div', '', 'body'), status = node('p', l('looking'), 'status'); status.setAttribute('role', 'status'); body.append(status); root.append(body);
const heartbeat = setInterval(() => { if (!closed) { try { port.postMessage({ type: 'ping' }); } catch { /* disconnect event handles failure */ } } }, 20_000);
document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
window.addEventListener('pagehide', () => { closed = true; window.clearTimeout(responseTimer); audio?.pause(); speechSynthesis.cancel(); clearInterval(heartbeat); port.disconnect(); });
const resize = new ResizeObserver(() => sendParent({ type: 'height', height: root.scrollHeight + 2 })); resize.observe(root);
function section(title: string, text?: string, bilingual = false) { const section = node('section'); section.append(node('h2', title)); if (text) appendLearningText(section, text, bilingual, input.text); return section; }
function retry(stage: 'dictionary' | 'learning') { const area = stage === 'dictionary' ? dictionaryArea : learningArea; area.replaceChildren(node('p', l(stage === 'dictionary' ? 'dictionaryError' : 'learningError'), 'status error'), button(l('retry'), () => stage === 'dictionary' ? lookup() : learn())); }
let dictionaryArea: HTMLElement, dictionaryDetails: HTMLElement, learningArea: HTMLElement, pronunciationArea: HTMLElement, learnButton: HTMLButtonElement, controls: HTMLElement;
let contextTranslationArea: HTMLElement | undefined, contextRequested = false;
let ipaList: HTMLElement, ipaButton: HTMLButtonElement, ipaOffset = 0;
function loadIpa() { if (connectionExpired) return; ipaList.querySelector('.error')?.remove(); ipaButton.hidden = false; ipaButton.disabled = true; ipaButton.textContent = l('looking'); try { port.postMessage({ type: 'phonetics', offset: ipaOffset }); } catch { expireConnection(); } }
function lookup() { if (connectionExpired) return; dictionaryArea.replaceChildren(node('p', l('looking'), 'status')); try { port.postMessage({ type: 'dictionary' }); } catch { expireConnection(); } }
function play(accent: 'uk' | 'us', target: HTMLButtonElement, word?: string) {
	audio?.pause(); speechSynthesis.cancel();
	const announcement = pronunciationArea.querySelector('.audio-status')!;
	if (!word && !dictionary?.[accent]) {
		const voice = englishVoice(speechSynthesis.getVoices(), accent);
		if (!voice) { announcement.textContent = l('missingVoice'); return; }
		const speech = new SpeechSynthesisUtterance(input.text); utterance = speech;
		speech.voice = voice; speech.lang = voice.lang; speech.rate = 0.95;
		announcement.textContent = `${l('localVoice')} · ${voice.name}`;
		speech.onerror = event => { if (utterance === speech && !['canceled', 'interrupted'].includes(event.error)) announcement.textContent = l('audioError'); };
		speechSynthesis.speak(speech); return;
	}
	const current = new Audio(pronunciationUrl(word || dictionary?.word || input.text, accent)); audio = current;
	announcement.textContent = l('audioLoading'); target.setAttribute('aria-busy', 'true');
	const done = () => { target.removeAttribute('aria-busy'); };
	current.onplaying = () => { if (audio === current) announcement.textContent = ''; done(); };
	current.onended = done;
	current.onpause = done;
	current.onerror = () => { if (audio === current) announcement.textContent = l('audioError'); done(); };
	void current.play().catch(() => { if (audio === current) announcement.textContent = l('audioError'); done(); });
}
function renderPronunciation() {
	pronunciationArea.replaceChildren();
	for (const accent of ['uk', 'us'] as const) {
		const phonetic = dictionary?.[accent], b = button('', () => play(accent, b), 'pronunciation');
		const pronunciationLabel = node('span', '', 'pronunciation-label');
		pronunciationLabel.append(node('span', l(accent), 'accent'), node('span', phonetic ? `/${phonetic}/` : l('synthetic'), phonetic ? 'ipa' : 'synthetic'));
		b.append(pronunciationLabel, createElement(Volume2));
		b.title = `${l(accent)} ${phonetic || l('synthetic')}`; pronunciationArea.append(b);
	}
	const announcement = node('p', '', 'audio-status status'); announcement.setAttribute('role', 'status'); pronunciationArea.append(announcement);
	if (!dictionary?.uk || !dictionary?.us) {
		const details = node('details', '', 'word-ipa'); details.append(node('summary', l('wordIpa')), node('p', l('wordIpaHint'), 'status'));
		ipaOffset = 0; ipaList = node('div'); ipaButton = button(l('moreIpa'), loadIpa); ipaButton.hidden = true;
		details.append(ipaList, ipaButton); details.addEventListener('toggle', () => { if (details.open && !ipaList.childElementCount && ipaButton.disabled === false) loadIpa(); });
		pronunciationArea.append(details);
	}
}
const posNames: Record<string, string> = { 'n.': '名词', 'v.': '动词', 'vt.': '及物动词', 'vi.': '不及物动词', 'adj.': '形容词', 'adv.': '副词', 'prep.': '介词', 'pron.': '代词', 'conj.': '连词', 'interj.': '感叹词', 'int.': '感叹词', 'aux.': '助动词', 'det.': '限定词', 'art.': '冠词', 'num.': '数词', 'abbr.': '缩写', 'contr.': '缩略形式', 'modal.': '情态动词' };
function renderDictionary(value: DictionaryEntry) {
	dictionary = value; dictionaryArea.replaceChildren(); dictionaryDetails.replaceChildren(); renderPronunciation();
	const source = node('a', l('dictionary'), 'source'); source.href = value.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.append(createElement(ArrowUpRight));
	if (!value.meanings.length) { dictionaryArea.append(source, node('p', l('missing'), 'status')); if (model && input.text.split(/\s+/).length > 1 && !busy && !lesson) learn(); return; }
	const meanings = node('section', '', 'meanings');
	const dictionaryHeading = node('div', '', 'section-heading'); dictionaryHeading.append(node('h2', l('meanings')), source); meanings.append(dictionaryHeading);
	for (const meaning of value.meanings) { const line = node('p', '', 'meaning'); if (meaning.pos) line.append(node('strong', meaning.pos.split(/\s+/).map(pos => `${pos} ${posNames[pos] || ''}`.trim()).join(' / '), 'pos')); line.append(node('span', meaning.text, 'meaning-text')); meanings.append(line); }
	dictionaryArea.append(meanings);
	if (value.examples.length) {
		const examples = node('details', '', 'dictionary-examples');
		const summary = node('summary'); summary.append(node('span', l('examples')), node('span', String(value.examples.length), 'detail-count')); examples.append(summary);
		for (const example of value.examples) { const pair = node('div', '', 'example'); const en = node('p', '', 'english'); en.lang = 'en'; appendStudyText(en, example.en, input.text); const zh = node('p', example.zh, 'example-translation'); zh.lang = 'zh'; pair.append(en, zh); examples.append(pair); }
		dictionaryDetails.append(examples);
	}
	if (value.forms.length) {
		const forms = node('details', '', 'dictionary-forms'), list = node('dl', '', 'forms-list'); forms.append(node('summary', l('forms')));
		for (const form of value.forms) list.append(node('dt', form.name), node('dd', form.value));
		forms.append(list); dictionaryDetails.append(forms);
	}
}
function renderContextTranslation(state: 'idle' | 'loading' | 'error' | 'expired' = 'idle') {
	if (!contextTranslationArea) return;
	contextTranslationArea.replaceChildren();
	const sentences = englishContextSentences(input.context), translations = lesson?.contextTranslations;
	const paired = state !== 'expired' && translations?.length === sentences.length;
	const originals = paired ? sentences : [input.context];
	for (const [index, original] of originals.entries()) {
		const pair = node('div', '', 'example context-pair'), en = node('p', '', 'english context-original');
		en.lang = 'en'; appendStudyText(en, original, input.text); pair.append(en);
		const translation = state === 'expired' ? undefined : paired ? translations![index] : lesson?.contextTranslation;
		if (translation) { const zh = node('p', translation, 'example-translation context-translation'); zh.lang = 'zh'; pair.append(zh); }
		contextTranslationArea.append(pair);
	}
	if (state === 'expired') contextTranslationArea.append(node('p', l('expired'), 'status error'));
	else if (lesson?.contextTranslation) {
		contextTranslationArea.append(node('p', l('contextTranslation'), 'context-provenance'));
	} else if (state === 'loading') {
		contextTranslationArea.append(node('p', l('contextWorking'), 'status'));
	} else if (!model) {
		contextTranslationArea.append(node('p', l('noModel'), 'status'));
	} else {
		if (state === 'error') contextTranslationArea.append(node('p', l('contextError'), 'status error'));
		contextTranslationArea.append(button(l('translateContext'), learn, 'context-translate-button'));
	}
}

function expireConnection() {
	if (closed || connectionExpired) return;
	connectionExpired = true; clearInterval(heartbeat); window.clearTimeout(responseTimer); port.disconnect(); root.removeAttribute('aria-busy');
	if (ready) {
		setBusy(false); learnButton.disabled = true;
		dictionaryArea.querySelectorAll<HTMLButtonElement>('button').forEach(control => { control.disabled = true; });
		if (ipaButton?.isConnected) { ipaButton.disabled = true; ipaButton.hidden = true; ipaList.append(node('p', l('expired'), 'status error')); }
		renderContextTranslation('expired'); learningArea.replaceChildren(node('p', l('expired'), 'status error'));
	}
	else status.textContent = l('expired');
}
function setBusy(value: boolean) {
	busy = value; window.clearTimeout(responseTimer);
	// The worker's 240 s request deadline normally resolves first. A separate frame
	// deadline also recovers a port that stays open without delivering a reply.
	if (value) responseTimer = window.setTimeout(expireConnection, 250_000);
	learnButton.disabled = !model || connectionExpired; learnButton.textContent = l(value ? 'stop' : 'learn'); learnButton.classList.toggle('working', value); learningArea.setAttribute('aria-busy', String(value));
}
function learn() {
	if (connectionExpired) return;
	if (busy) { learnButton.disabled = true; window.clearTimeout(responseTimer); responseTimer = window.setTimeout(expireConnection, 5_000); try { port.postMessage({ type: 'cancel' }); } catch { expireConnection(); } return; }
	if (!model) return;
	lesson = undefined; contextRequested = true; setBusy(true); renderContextTranslation('loading'); controls.classList.remove('has-lesson'); learningArea.replaceChildren(node('p', l('thinking'), 'status loading')); learningArea.querySelector('.status')?.setAttribute('role', 'status'); try { port.postMessage({ type: 'learn' }); } catch { expireConnection(); }
}
function renderLesson(value: EnglishLesson, cached: boolean) {
	lesson = value; setBusy(false); renderContextTranslation(); controls.classList.add('has-lesson');
	const provenance = node('p', l('generated'), 'provenance');
	if (cached) provenance.append(node('span', l('cached'), 'cache-status'));
	learningArea.replaceChildren(provenance);
	const sections: Array<[Exclude<keyof EnglishLesson, 'contextTranslation' | 'contextTranslations'>, EnglishLabel]> = [['translation','translation'],['contextual','contextual'],['grammar','grammar'],['examples','moreExamples'],['memory','memory'],['pronunciation','pronunciation']];
	for (const [key, label] of sections) { const part = section(l(label), value[key], key === 'examples'); part.className = `lesson-section lesson-${key}`; learningArea.append(part); }
}
function init(message: any) {
	ready = true; l = englishText(typeof message.language === 'string' ? message.language : navigator.language); input = message.input; models = message.models;
	document.documentElement.dataset.theme = input.theme || 'auto';
	document.documentElement.lang = (message.language || navigator.language).replace('_', '-');
	model = models.find(item => item.id === message.selected)?.id || models[0]?.id;
	heading.textContent = l('title'); closeButton.setAttribute('aria-label', l('close')); root.removeAttribute('aria-busy'); body.replaceChildren();
	const selected = node('p', input.text, 'selected-text'); selected.lang = 'en';
	selected.classList.toggle('is-passage', input.text.length > 48 || input.text.split(/\s+/).length > 6); body.append(selected);
	pronunciationArea = node('div', '', 'pronunciations'); body.append(pronunciationArea); renderPronunciation();
	dictionaryArea = node('div', '', 'dictionary'); body.append(dictionaryArea);
	if (message.dictionaryQuery || !model) dictionaryArea.append(node('p', l(message.dictionaryQuery ? 'looking' : 'sentence'), 'status'));
	dictionaryDetails = node('div', '', 'dictionary-details'); body.append(dictionaryDetails);
	contextTranslationArea = undefined; contextRequested = false;
	if (input.context) {
		const context = node('details', '', 'context');
		contextTranslationArea = node('div', '', 'context-content'); contextTranslationArea.setAttribute('aria-live', 'polite');
		context.append(node('summary', l('context')), contextTranslationArea); body.append(context); renderContextTranslation();
		context.addEventListener('toggle', () => { if (context.open && !contextRequested && !lesson?.contextTranslation && !busy && model) learn(); });
	}
	controls = node('div', '', 'learning-controls');
	learnButton = button(l('learn'), learn, 'primary'); learnButton.disabled = !model;
	if (message.dictionaryQuery || !model) controls.append(node('p', l('learnHint'), 'learn-hint'));
	if (models.length) controls.append(learnButton, node('p', l('modelFollow'), 'model-follow'));
	else controls.append(node('p', l('noModel'), 'status'), button(l('settings'), () => { void chrome.runtime.openOptionsPage(); }));
	body.append(controls); learningArea = node('div', '', 'lesson'); body.append(learningArea);
	// The frame is a non-modal panel: enter it on open, then Escape returns to the text.
	root.tabIndex = -1; root.focus({ preventScroll: true });
	if (!message.dictionaryQuery && model) learn();
}
port.onMessage.addListener(message => {
	if (closed || connectionExpired) return;
	if (message.type === 'init') init(message);
	else if (ready && message.type === 'dictionary') renderDictionary(message.value);
	else if (ready && message.type === 'lesson') renderLesson(message.value, message.cached);
	else if (ready && message.type === 'phonetics') {
		for (const item of message.values as Array<{ word: string; uk: string; us: string }>) {
			const row = node('div', '', 'ipa-row'); row.append(node('strong', item.word));
			for (const accent of ['uk', 'us'] as const) {
				const b = button(`${l(accent)} ${item[accent] ? '/' + item[accent] + '/' : l('noIpa')}`, () => play(accent, b, item.word)); b.prepend(createElement(Volume2)); row.append(b);
			}
			ipaList.append(row);
		}
		ipaOffset = message.next; ipaButton.disabled = false; ipaButton.textContent = l('moreIpa'); ipaButton.hidden = message.next >= message.total;
	}
	else if (ready && message.type === 'cancelled') { setBusy(false); controls.classList.remove('has-lesson'); learningArea.replaceChildren(); renderContextTranslation(); }
	else if (message.type === 'error') {
		if (!ready || message.stage === 'init') { status.textContent = l('expired'); root.removeAttribute('aria-busy'); }
		else if (message.stage === 'phonetics') { ipaButton.disabled = false; ipaButton.hidden = false; ipaButton.textContent = l('retry'); if (!ipaList.childElementCount) ipaList.append(node('p', l('dictionaryError'), 'status error')); }
		else { if (message.stage === 'learning') { setBusy(false); renderContextTranslation('error'); } retry(message.stage); }
	}
});
port.onDisconnect.addListener(expireConnection);
port.postMessage({ type: 'init' });
