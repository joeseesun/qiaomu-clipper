// Runs inside an X Articles tab (injected on demand when the writer publishes). Receives one article from the writer page over a port,
// then drives the editor through main-world.js. Adapted from xPoster's importer (MIT); see THIRD_PARTY_NOTICES.md.
import * as shared from './shared';
import { findEditor } from './adapter';

const TO_MAIN = 'qiaomu-write-x';
const FROM_MAIN = 'qiaomu-write-x-main';
const PORT_NAME = 'qiaomu-write-x';
const MAIN_SILENCE_TIMEOUT_MS = 180000;
const STATUS_ID = '__qiaomu_write_status__';

interface Prepared { ok: boolean; base64?: string; mime?: string; fileName?: string; bytes?: number; error?: string; source?: string }
declare global { interface Window { __qiaomuWriteXContent?: boolean } }

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const isArticleRoute = () => /^https:\/\/(?:x|twitter)\.com\/compose\/articles(?:$|[/?#])/.test(location.href);
const isEditorRoute = () => /^https:\/\/(?:x|twitter)\.com\/compose\/articles\/edit\//.test(location.href);
const articleIdFromUrl = () => location.pathname.match(/\/compose\/articles\/edit\/(\d+)/)?.[1] ?? null;
const editor = () => findEditor(document, location);

class Cancelled extends Error { cancelled = true; summary?: unknown; }

// ---- a small progress card on the X page ----------------------------------------------------------------------------------
function showCard(text: string, level: 'work' | 'done' | 'error' | 'warn', onStop?: () => void): void {
	let card = document.getElementById(STATUS_ID);
	if (!card) {
		card = document.createElement('section');
		card.id = STATUS_ID;
		card.setAttribute('role', 'status');
		card.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;width:300px;padding:12px 14px;border-radius:14px;background:#0f1419;color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)';
		document.body.append(card);
	}
	card.textContent = '';
	const title = document.createElement('div');
	title.style.cssText = 'font-weight:700;margin-bottom:4px';
	title.textContent = level === 'done' ? '乔木 · 已写入草稿' : level === 'error' ? '乔木 · 写入失败' : level === 'warn' ? '乔木 · 已停止' : '乔木 · 正在写入 X 文章';
	const body = document.createElement('div');
	body.style.opacity = '.85';
	body.textContent = text;
	card.append(title, body);
	if (level === 'work' && onStop) {
		const stop = document.createElement('button');
		stop.type = 'button'; stop.textContent = '停止';
		stop.style.cssText = 'margin-top:8px;padding:4px 12px;border:1px solid #536471;border-radius:8px;background:transparent;color:#fff;cursor:pointer;font:inherit';
		stop.addEventListener('click', onStop);
		card.append(stop);
	}
	if (level !== 'work') window.setTimeout(() => { if (card?.isConnected && card.dataset.text === text) card.remove(); }, 9000);
	card.dataset.text = text;
}

// ---- navigation inside X ---------------------------------------------------------------------------------------------------
function waitFor(test: () => boolean, timeoutMs: number, step = 250): Promise<boolean> {
	return new Promise(resolve => {
		const deadline = Date.now() + timeoutMs;
		const tick = () => { if (test()) resolve(true); else if (Date.now() > deadline) resolve(false); else window.setTimeout(tick, step); };
		tick();
	});
}

function findCreateButton(): HTMLElement | null {
	const labels = ['create', 'compose', '撰写', '新建', '创建', '新規', '作成'];
	const empty = document.querySelector<HTMLElement>("a[data-testid='empty_state_button_text']");
	if (empty) return empty;
	const root = document.getElementById('root-header')?.closest('div')?.parentElement ?? document;
	for (const path of Array.from(root.querySelectorAll('button svg path'))) {
		if ((path.getAttribute('d') || '').startsWith('M14.543')) { const button = path.closest('button'); if (button) return button; }
	}
	for (const button of Array.from(document.querySelectorAll<HTMLElement>("button, a[role='button']"))) {
		const aria = (button.getAttribute('aria-label') || '').toLowerCase().trim();
		if (labels.includes(aria)) return button;
	}
	return null;
}

async function goToArticleList(): Promise<void> {
	const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href='/compose/articles'], a[href$='/compose/articles']")).find(item => item.offsetParent);
	if (link) { link.click(); if (await waitFor(() => isArticleRoute() && !isEditorRoute(), 5000, 200)) return; }
	history.pushState(null, '', '/compose/articles');
	window.dispatchEvent(new PopStateEvent('popstate'));
	await waitFor(() => isArticleRoute() && !isEditorRoute(), 4000, 200);
}

// An editor that is already open and empty is reused; anything else gets a brand new article so nothing the writer typed there is touched.
const editorIsEmpty = () => !Array.from(document.querySelectorAll('[data-contents="true"] [data-text="true"]')).some(node => (node.textContent ?? '').trim());

async function ensureFreshEditor(): Promise<void> {
	if (isEditorRoute() && editor() && editorIsEmpty()) return;
	if (isEditorRoute()) await goToArticleList();
	if (!isArticleRoute()) await goToArticleList();
	for (let attempt = 0; attempt < 30; attempt++) {
		const button = findCreateButton();
		if (button) { button.click(); break; }
		if (attempt === 29) throw new Error('没有找到 X 文章里的「新建」按钮，请确认已登录并开通了文章功能');
		await sleep(250);
	}
	if (!(await waitFor(() => !!editor(), 20000))) throw new Error('X 文章编辑器没有打开');
}

// ---- main-world bridge ---------------------------------------------------------------------------------------------------
let mainReady = false;
function waitForMainReady(timeoutMs = 6000): Promise<boolean> {
	if (mainReady) return Promise.resolve(true);
	return new Promise(resolve => {
		const deadline = Date.now() + timeoutMs;
		const listener = (event: MessageEvent) => { if (event.source === window && event.data?.source === FROM_MAIN && event.data.kind === 'ready') { mainReady = true; window.removeEventListener('message', listener); resolve(true); } };
		window.addEventListener('message', listener);
		const tick = () => {
			window.postMessage({ source: TO_MAIN, kind: 'ready?' }, '*');
			if (mainReady) return;
			if (Date.now() > deadline) { window.removeEventListener('message', listener); resolve(false); return; }
			window.setTimeout(tick, 250);
		};
		tick();
	});
}

function runMain(payload: unknown, files: Map<string, unknown>, progress: (text: string) => void): Promise<any> {
	return new Promise((resolve, reject) => {
		let timeout = 0;
		const finish = () => { window.clearTimeout(timeout); window.removeEventListener('message', listener); };
		const refresh = () => { window.clearTimeout(timeout); timeout = window.setTimeout(() => { finish(); reject(new Error('X 编辑器没有响应')); }, MAIN_SILENCE_TIMEOUT_MS); };
		const listener = (event: MessageEvent) => {
			if (event.source !== window || event.data?.source !== FROM_MAIN) return;
			const message = event.data;
			if (message.kind === 'file-request') {
				const file = files.get(message.token || message.marker);
				window.postMessage({ source: TO_MAIN, kind: 'file-response', requestId: message.requestId, ok: Boolean(file), file: file || null, error: file ? null : '没有找到准备好的图片' }, '*');
				refresh(); return;
			}
			if (message.kind === 'progress') { progress(String(message.text || '')); refresh(); return; }
			if (message.kind === 'done') { finish(); resolve(message.summary || {}); return; }
			if (message.kind === 'cancelled') { finish(); const error = new Cancelled(message.reason || '已停止写入'); error.summary = message.summary; reject(error); return; }
			if (message.kind === 'error') { finish(); const error: any = new Error(message.error || 'X 编辑器写入失败'); error.mainSummary = message.summary || null; reject(error); }
		};
		window.addEventListener('message', listener);
		refresh();
		window.postMessage({ source: TO_MAIN, kind: 'run', payload }, '*');
	});
}

const extFor = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[mime] ?? 'png';
function safeName(name: string | undefined, fallback: string, mime: string): string {
	const base = String(name || '').split(/[?#]/)[0].split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return `${base || fallback}.${extFor(mime)}`;
}

// ---- one import ------------------------------------------------------------------------------------------------------------
async function runImport(markdown: string, prepared: Map<string, Prepared>, post: (message: unknown) => void, state: { cancel: boolean }): Promise<void> {
	const started = performance.now();
	const say = (text: string, level: 'work' | 'done' | 'error' | 'warn' = 'work') => { post({ type: 'progress', text, level }); showCard(text, level, () => { state.cancel = true; window.postMessage({ source: TO_MAIN, kind: 'cancel' }, '*'); showCard('正在停止…', 'work'); post({ type: 'progress', text: '正在停止…', level: 'work' }); }); };
	const check = () => { if (state.cancel) throw new Cancelled('已停止写入'); };
	try {
		say('正在准备文章…');
		if (!isArticleRoute()) throw new Error('这个标签页不是 X 文章页，请先登录 X 并打开「文章」');
		const parsed = shared.parseMarkdown(markdown, { setTitle: true, setCover: true });
		const { segments } = shared.applyLimits(parsed.segments, { maxImagesPerImport: Infinity, maxTablesPerImport: Infinity, maxTweetsPerImport: Infinity, appendSignature: false });
		const limited = { ...parsed, segments };
		const estimate = shared.articleMediaEstimate(limited, { setCover: true });
		if (estimate.overSoftLimit) throw new Error(`图片和表格共 ${estimate.total} 项，超过 X 文章稳妥的 ${shared.ARTICLE_MEDIA_POLICY.limit} 项上限，请删减后再发`);
		check();
		if (!(await waitForMainReady())) throw new Error('X 编辑器桥接没有就绪，请刷新 X 页面后重试');
		say('正在打开新文章…');
		await ensureFreshEditor();
		check();

		const lookup = (source: string, fallback: string): Prepared => {
			const found = prepared.get(source);
			if (found?.ok) return { ...found, fileName: safeName(found.fileName, fallback, found.mime || 'image/png'), source };
			if (source.startsWith('data:')) { const data = shared.parseDataUri(source); if (data.ok) return { ...data, ok: true, fileName: `${fallback}.png`, source }; }
			return { ok: false, error: found?.error || '图片没有准备好', source };
		};
		const images = segments.filter(segment => segment.type === 'image');
		const imageMap = new Map(images.map((segment, index) => [segment, lookup(String(segment.source), `image-${index + 1}`)] as const));
		const coverSource = limited.cover || '';
		const coverSegment = coverSource && !segments.some(segment => segment.type === 'image' && shared.imageSourcesMatch(String(segment.source), coverSource)) ? { type: 'image' as const, source: coverSource, alt: 'cover' } : null;
		const coverResult = coverSegment ? lookup(coverSource, 'cover') : null;
		const tables = segments.filter(segment => segment.type === 'table');
		const tableMap = new Map<any, any>();
		if (tables.length) say(`正在把 ${tables.length} 个表格转成图片…`);
		for (const [index, table] of tables.entries()) { check(); try { tableMap.set(table, await shared.renderTableImage(table, `table-${index + 1}.png`)); } catch (error) { tableMap.set(table, { ok: false, error: (error as Error).message }); } }
		const failed = [...imageMap.values(), ...tableMap.values(), ...(coverResult ? [coverResult] : [])].filter(item => !item?.ok);
		if (failed.length) throw new Error(`有 ${failed.length} 张图片没能准备好：${failed[0].error || '未知原因'}。已停止，没有写入 X。`);
		check();

		const plan = shared.buildPastePlan(segments, imageMap, tableMap, { coverSource, coverResult });
		const files = new Map<string, unknown>();
		for (const item of plan.plan || []) {
			if (item?.op?.type !== 'image' || !item.op.file?.base64) continue;
			files.set(item.marker, item.op.file);
			item.op.file = { token: item.marker, mime: item.op.file.mime, fileName: item.op.file.fileName, alt: item.op.file.alt || '', bytes: item.op.file.bytes || null };
		}
		plan.title = limited.title || null; plan.cover = limited.cover || null; plan.origin = 'qiaomu-write';
		say('正在写入 X 编辑器…');
		const main = await runMain(plan, files, text => say(text));
		const summary = { title: limited.title, main, elapsedMs: Math.round(performance.now() - started), articleId: articleIdFromUrl(), url: location.href.split('#')[0] };
		const imageFailures = Number(main?.imgFail || 0) + Number(main?.atomicFail || 0);
		const message = imageFailures ? `草稿已写入，但有 ${imageFailures} 处图片或特殊块没能放进去，请在 X 里检查。` : '草稿已写入，请在 X 里检查后再发布。';
		say(message, imageFailures ? 'warn' : 'done');
		post({ type: 'done', summary, message });
	} catch (error) {
		const e = error as Cancelled & { mainSummary?: unknown };
		if (e?.cancelled) { say('已停止写入', 'warn'); post({ type: 'cancelled' }); return; }
		say(e?.message || '写入失败', 'error');
		post({ type: 'error', error: e?.message || String(error) });
	}
}

if (!window.__qiaomuWriteXContent) {
	window.__qiaomuWriteXContent = true;
	chrome.runtime.onConnect.addListener(port => {
		if (port.name !== PORT_NAME) return;
		const prepared = new Map<string, Prepared>();
		const state = { cancel: false };
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the writer page closed */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: isArticleRoute(), editor: !!editor() });
			else if (message?.type === 'image') prepared.set(String(message.source), { ok: true, base64: message.base64, mime: message.mime, fileName: message.fileName, bytes: message.bytes, source: message.source });
			else if (message?.type === 'imageError') prepared.set(String(message.source), { ok: false, error: message.error, source: message.source });
			else if (message?.type === 'cancel') { state.cancel = true; window.postMessage({ source: TO_MAIN, kind: 'cancel' }, '*'); }
			else if (message?.type === 'run' && !busy) { busy = true; state.cancel = false; void runImport(String(message.markdown || ''), prepared, post, state).finally(() => { busy = false; }); }
		});
		port.onDisconnect.addListener(() => { state.cancel = true; });
	});
}
