import en from '../i18n/ui-en.json';
import zhTW from '../i18n/ui-zh_TW.json';
import helperEn from '../i18n/helper-en.json';
import helperZhTW from '../i18n/helper-zh_TW.json';

// The interface was written in Chinese. A string is looked up by its own Chinese text, so the source stays readable:
//   t('已保存到 {0}', [vault])
// Simplified Chinese shows the text as written; Traditional Chinese and English have a catalog; every other language shows English.
// A test checks that each string used in the source (and in the HTML pages) has an entry in both catalogs.
type Catalog = Record<string, string>;

let override: string | undefined;

// Set once the person's chosen language is known (the "language" setting); until then the browser's language decides.
export function setUiLanguage(code: string | undefined): void { override = code || undefined; }

function browserLanguage(): string {
	try { return (typeof navigator !== 'undefined' && navigator.language) || 'en'; } catch { return 'en'; }
}

export type UiLanguage = 'zh_CN' | 'zh_TW' | 'en';

export function uiLanguage(): UiLanguage {
	const code = (override || browserLanguage()).replace('-', '_').toLowerCase();
	if (code.startsWith('zh')) return /tw|hk|mo|hant/.test(code) ? 'zh_TW' : 'zh_CN';
	return 'en';
}

const catalogs: Record<UiLanguage, Catalog | undefined> = { zh_CN: undefined, zh_TW: zhTW as Catalog, en: en as Catalog };

export function t(source: string, args?: ReadonlyArray<string | number | null | undefined>): string {
	const text = catalogs[uiLanguage()]?.[source] ?? source;
	return args ? text.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')) : text;
}

// ---- static pages -------------------------------------------------------------------------------------------------
const HAN = /[一-鿿]/;
const INLINE = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SPAN', 'KBD', 'U', 'BR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
export const normalizeUnit = (value: string): string => value.replace(/\s+/g, ' ').trim();

export type StaticUnit = { source: string; apply: (text: string) => void };

// The pieces of text in a page that are written in Chinese: a text node, an element whose content is text with a little inline markup, or an attribute.
export function staticUnits(root: ParentNode): StaticUnit[] {
	const units: StaticUnit[] = [];
	const visit = (element: Element) => {
		if (SKIP.has(element.tagName)) return;
		for (const name of ATTRIBUTES) {
			const value = element.getAttribute(name);
			if (value && HAN.test(value)) units.push({ source: normalizeUnit(value), apply: text => element.setAttribute(name, text) });
		}
		const children = Array.from(element.children);
		if (!HAN.test(element.textContent || '')) { children.forEach(visit); return; }
		const markup = children.length > 0 && children.every(child => INLINE.has(child.tagName) && child.children.length === 0);
		const ownText = Array.from(element.childNodes).some(node => node.nodeType === 3 && HAN.test(node.nodeValue || ''));
		if (children.length === 0 || (markup && ownText)) {
			const source = normalizeUnit(children.length ? element.innerHTML : element.textContent || '');
			if (source) units.push({ source, apply: text => { if (children.length) element.innerHTML = text; else element.textContent = text; } });
			return;
		}
		for (const node of Array.from(element.childNodes)) {
			if (node.nodeType === 3 && HAN.test(node.nodeValue || '')) {
				const source = normalizeUnit(node.nodeValue || '');
				units.push({ source, apply: text => { node.nodeValue = text; } });
			}
		}
		children.forEach(visit);
	};
	const elements = root instanceof Element ? [root] : Array.from((root as Document | DocumentFragment).children ?? []);
	elements.forEach(visit);
	return units;
}

// Show a page that was written in Chinese in the person's language. Simplified Chinese is left as it is.
export function translateStatic(root: ParentNode = document): void {
	const catalog = catalogs[uiLanguage()];
	if (!catalog) return;
	for (const unit of staticUnits(root)) {
		const translated = catalog[unit.source];
		if (translated) unit.apply(translated);
	}
}

// ---- messages from the local helper -----------------------------------------------------------------------------------
// The helper (Python) writes its messages in Chinese. They are shown in the person's language by matching them against the
// helper catalogs: a whole message, a message with values in it ({0}), or the fixed beginning or end of a message that a
// detail was added to.
const helperCatalogs: Record<UiLanguage, Catalog | undefined> = { zh_CN: undefined, zh_TW: helperZhTW as Catalog, en: helperEn as Catalog };
type Compiled = { templates: Array<[RegExp, string]>; fragments: Array<[string, string]> };
const compiled = new WeakMap<Catalog, Compiled>();

function compile(catalog: Catalog): Compiled {
	let done = compiled.get(catalog);
	if (done) return done;
	const templates: Compiled['templates'] = [], fragments: Compiled['fragments'] = [];
	for (const [key, value] of Object.entries(catalog)) {
		if (/\{\d+\}/.test(key)) templates.push([new RegExp('^' + key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d+\}/g, '(.+?)') + '$'), value]);
		else fragments.push([key, value]);
	}
	fragments.sort((a, b) => b[0].length - a[0].length);
	done = { templates, fragments };
	compiled.set(catalog, done);
	return done;
}

export function translateHelperText(text: string): string {
	if (!HAN.test(text)) return text;
	const catalog = helperCatalogs[uiLanguage()];
	if (!catalog) return text;
	if (catalog[text]) return catalog[text];
	const { templates, fragments } = compile(catalog);
	for (const [pattern, value] of templates) {
		const match = pattern.exec(text);
		if (match) return value.replace(/\{(\d+)\}/g, (_, index) => match[Number(index) + 1] ?? '');
	}
	// A detail after a fixed beginning (or before a fixed end) is kept as it was, with the full-width marks of Chinese made plain for English.
	const tidy = (rest: string) => uiLanguage() === 'en' ? rest.replace(/（/g, ' (').replace(/）/g, ')').replace(/：/g, ': ').replace(/，/g, ', ').replace(/。/g, '. ').trim() : rest;
	for (const [key, value] of fragments) {
		if (text.startsWith(key)) return value + tidy(text.slice(key.length));
		if (text.endsWith(key)) return tidy(text.slice(0, text.length - key.length)) + value;
	}
	return text;
}

const HELPER_TEXT_FIELDS = new Set(['error', 'stage', 'message', 'hint', 'note', 'problems', 'notes']);
// A reply from the helper with its messages in the person's language. Codes (like helper-offline) and values are left alone.
export function localizeHelperReply<T>(reply: T): T {
	const visit = (value: unknown, field?: string): unknown => {
		if (typeof value === 'string') return field && HELPER_TEXT_FIELDS.has(field) ? translateHelperText(value) : value;
		if (Array.isArray(value)) return value.map(item => visit(item, field));
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, key)]));
		return value;
	};
	return visit(reply) as T;
}
