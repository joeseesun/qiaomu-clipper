// Runs inside an X Articles tab (injected on demand when the writer publishes). Receives one article from the writer page over a port,
// then drives the editor through main-world.js. Adapted from xPoster's importer (MIT); see THIRD_PARTY_NOTICES.md.
import * as shared from './shared';
import { whileActive } from './stop';
import { describeXMediaMessage } from './media-messages';
import { findEditor } from './adapter';
import { t } from '../utils/ui-text';

const TO_MAIN = 'qiaomu-write-x-v2';
const FROM_MAIN = 'qiaomu-write-x-main-v2';
const PORT_NAME = 'qiaomu-write-x-v2';
const MAIN_SILENCE_TIMEOUT_MS = 180000;
const STATUS_ID = '__qiaomu_write_status__';

interface Prepared { ok: boolean; base64?: string; mime?: string; fileName?: string; bytes?: number; error?: string; source?: string }
declare global { interface Window { __qiaomuWriteXContentV2?: { alive: () => boolean; dispose: () => void } } }
interface ImportState { cancel: boolean; controller?: AbortController; resume?: boolean; forceNew?: boolean; recovery?: { completed: number; total: number }; owner?: string; retry?: (resume: boolean) => void; dismiss?: () => void }
let activeImport: ImportState | undefined;

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const isArticleRoute = () => /^https:\/\/(?:x|twitter)\.com\/compose\/articles(?:$|[/?#])/.test(location.href);
const isEditorRoute = () => /^https:\/\/(?:x|twitter)\.com\/compose\/articles\/edit\//.test(location.href);
const articleIdFromUrl = () => location.pathname.match(/\/compose\/articles\/edit\/(\d+)/)?.[1] ?? null;
const editor = () => findEditor(document, location);

class Cancelled extends Error { cancelled = true; stopUnconfirmed?: boolean; summary?: unknown; recovery?: { completed: number; total: number }; }

// ---- a small progress card on the X page ----------------------------------------------------------------------------------
function showCard(text: string, level: 'work' | 'done' | 'error' | 'warn', onStop?: () => void, recovery?: { owner?: string; retry: () => void; resume?: () => void; dismiss?: () => void }): void {
 let card = document.getElementById(STATUS_ID);
 if (!card) { card = document.createElement('section'); card.id = STATUS_ID; card.setAttribute('role','status'); document.body.append(card); }
 card.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;width:min(340px,calc(100vw - 40px));box-sizing:border-box;padding:12px 14px;border-radius:14px;background:#0f1419;color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)';
 card.textContent='';card.dataset.owner=recovery?.owner || '';card.dataset.text=text;
 const title=document.createElement('div');title.style.cssText='font-weight:700;margin-bottom:4px';
 title.textContent=level==='done' ? t('已写入 X 草稿') : level==='error' ? t('没能写入 X') : level==='warn' ? t('已停止') : t('正在发到 X 文章');
 const body=document.createElement('div');body.style.cssText='opacity:.85;overflow-wrap:anywhere';body.textContent=text;card.append(title,body);
 const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
 const action=(label:string,run:()=>void,primary=false)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText=`width:auto;flex:none;padding:5px 10px;border:1px solid #536471;border-radius:8px;background:${primary?'#eff3f4':'#0f1419'};color:${primary?'#0f1419':'#fff'};cursor:pointer;font:inherit`;button.addEventListener('click',()=>{button.disabled=true;run();});actions.append(button);return button;};
 if(level==='work'&&onStop)action(t('停止'),onStop);
 if((level==='error'||level==='warn')&&recovery){
  const note=document.createElement('p');note.style.cssText='margin:8px 0 0;font-size:12px;opacity:.85';note.textContent=t('重新写入会创建新草稿，当前草稿会保留。');card.append(note);
  if(recovery.resume)action(t('继续剩余'),recovery.resume,true).dataset.recoveryAction='true';
  action(t('重新写入'),recovery.retry,!recovery.resume).dataset.recoveryAction='true';
  action(t('关闭'),()=>{card?.remove();recovery.dismiss?.();});
 }
 if((level==='error'||level==='warn')&&!recovery)action(t('关闭'),()=>card?.remove());
 if(actions.children.length)card.append(actions);
 if(level==='done')window.setTimeout(()=>{if(card?.isConnected&&card.dataset.text===text)card.remove();},9000);
}

// ---- navigation inside X ---------------------------------------------------------------------------------------------------
function waitFor(test: () => boolean, timeoutMs: number, step = 250, signal?: AbortSignal): Promise<boolean> {
 return new Promise((resolve,reject)=>{
  const deadline=Date.now()+timeoutMs;let timer=0;
  const finish=(value:boolean)=>{window.clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};
  const abort=()=>{window.clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Cancelled('已停止写入'));};
  const tick=()=>{if(signal?.aborted){abort();return;}try{if(test())finish(true);else if(Date.now()>deadline)finish(false);else timer=window.setTimeout(tick,step);}catch(error){signal?.removeEventListener('abort',abort);reject(error);}};
  signal?.addEventListener('abort',abort,{once:true});tick();
 });
}
const checkStop=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Cancelled('已停止写入');};

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

async function goToArticleList(signal?: AbortSignal): Promise<void> {
	checkStop(signal);
	const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href='/compose/articles'], a[href$='/compose/articles']")).find(item => item.offsetParent);
	if (link) { link.click(); if (await waitFor(() => isArticleRoute() && !isEditorRoute(), 5000, 200, signal)) return; }
	checkStop(signal);
	history.pushState(null, '', '/compose/articles');
	window.dispatchEvent(new PopStateEvent('popstate'));
	await waitFor(() => isArticleRoute() && !isEditorRoute(), 4000, 200, signal);
}

// An editor that is already open and empty is reused; anything else gets a brand new article so nothing the writer typed there is touched.
const editorIsEmpty = () => { const root=editor(); return Boolean(root && !root.querySelector('[data-block][contenteditable="false"],img,video') && !Array.from(root.querySelectorAll('[data-text="true"]')).some(node=>(node.textContent??'').trim())); };

async function ensureFreshEditor(signal?: AbortSignal, forceNew = false): Promise<void> {
	checkStop(signal);
	if (!forceNew && isEditorRoute() && editor() && editorIsEmpty()) return;
	if (isEditorRoute()) await goToArticleList(signal);
	if (!isArticleRoute()) await goToArticleList(signal);
	for (let attempt = 0; attempt < 30; attempt++) {
		checkStop(signal);
		const button = findCreateButton();
		if (button) { button.click(); break; }
		if (attempt === 29) throw new Error('没有找到 X 文章里的「新建」按钮，请确认已登录并开通了文章功能');
		await sleep(250);
	}
	if (!(await waitFor(() => !!editor(), 20000, 250, signal))) throw new Error('X 文章编辑器没有打开');
}

// ---- main-world bridge ---------------------------------------------------------------------------------------------------
function waitForMainReady(timeoutMs = 6000): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		let finished = false;
		const listener = (event: MessageEvent) => { if (event.source === window && event.data?.source === FROM_MAIN && event.data.kind === 'ready') { finished = true; window.removeEventListener('message', listener); if (event.data.busy) reject(new Error(t('X 正在处理上一次写入，请稍后重试'))); else resolve(true); } };
		window.addEventListener('message', listener);
		const tick = () => {
			window.postMessage({ source: TO_MAIN, kind: 'ready?' }, '*');
			if (finished) return;
			if (Date.now() > deadline) { window.removeEventListener('message', listener); resolve(false); return; }
			window.setTimeout(tick, 250);
		};
		tick();
	});
}

function runMain(payload: unknown, files: Map<string, unknown>, progress: (text: string) => void, signal?: AbortSignal): Promise<any> {
	return new Promise((resolve, reject) => {
		const runId = crypto.randomUUID();
		let timeout = 0, stopping = false;
		const cancelMain = () => window.postMessage({ source: TO_MAIN, kind: 'cancel', runId }, '*');
		const finish = () => { window.clearTimeout(timeout); window.removeEventListener('message', listener); signal?.removeEventListener('abort', abort); };
		const abort = () => { if(stopping)return;stopping=true;cancelMain();window.clearTimeout(timeout);timeout=window.setTimeout(()=>{finish();const error=new Cancelled('已停止写入');error.stopUnconfirmed=true;reject(error);},10000); };
		const refresh = () => { window.clearTimeout(timeout); timeout = window.setTimeout(() => { cancelMain(); finish(); reject(new Error('X 编辑器没有响应')); }, MAIN_SILENCE_TIMEOUT_MS); };
		const listener = (event: MessageEvent) => {
			if (event.source !== window || event.data?.source !== FROM_MAIN) return;
			const message = event.data;
			if (message.runId !== runId) return;
			if(stopping && !['done','error','cancelled'].includes(message.kind))return;
			if (message.kind === 'file-request') {
				const file = files.get(message.token || message.marker);
				window.postMessage({ source: TO_MAIN, kind: 'file-response', runId, requestId: message.requestId, ok: Boolean(file), file: file || null, error: file ? null : '没有找到准备好的图片' }, '*');
				refresh(); return;
			}
			if (message.kind === 'progress') { progress(String(message.text || '')); refresh(); return; }
			if (message.kind === 'done') { finish(); if(stopping)reject(new Cancelled('已停止写入'));else resolve(message.summary || {}); return; }
			if (message.kind === 'cancelled') { finish(); const error = new Cancelled(message.reason || '已停止写入'); error.summary = message.summary; error.recovery = message.recovery; reject(error); return; }
			if (message.kind === 'error') { finish(); const error: any = new Error(message.code === 'busy' ? t('X 正在处理上一次写入，请稍后重试') : message.error || 'X 编辑器写入失败'); error.mainSummary = message.summary || null; error.recovery = message.recovery; reject(error); }
		};
		if (signal?.aborted) { reject(new Cancelled('已停止写入')); return; }
		window.addEventListener('message', listener);
		signal?.addEventListener('abort', abort, { once: true });
		refresh();
		window.postMessage({ source: TO_MAIN, kind: 'run', runId, payload }, '*');
	});
}

const extFor = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4' } as Record<string, string>)[mime] ?? 'png';
function safeName(name: string | undefined, fallback: string, mime: string): string {
	const base = String(name || '').split(/[?#]/)[0].split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return `${base || fallback}.${extFor(mime)}`;
}

// ---- one import ------------------------------------------------------------------------------------------------------------
async function runImport(markdown: string, prepared: Map<string, Prepared>, post: (message: unknown) => void, state: ImportState): Promise<void> {
	const started = performance.now();
	const say = (raw: string, level: 'work' | 'done' | 'error' | 'warn' = 'work') => { const text = describeXMediaMessage(raw) + ((level==='warn'||level==='error')&&state.recovery ? ` ${t('已保留 {0}/{1} 项媒体，可继续剩余。',[state.recovery.completed,state.recovery.total])}` : ''); post({ type: 'progress', text, level }); showCard(text, level, () => { state.cancel = true; state.controller?.abort(); showCard('正在停止…', 'work'); post({ type: 'progress', text: '正在停止…', level: 'work' }); }, state.retry ? {owner:state.owner,retry:()=>state.retry?.(false),resume:state.recovery?()=>state.retry?.(true):undefined,dismiss:state.dismiss} : undefined); };
	const check = () => { if (state.cancel) throw new Cancelled('已停止写入'); };
	try {
		say('正在准备文章…');
		if (!isArticleRoute()) throw new Error('这个标签页不是 X 文章页，请先登录 X 并打开「文章」');
		const parsed = shared.parseMarkdown(markdown, { setTitle: true, setCover: true });
		const { segments } = shared.applyLimits(parsed.segments, { maxImagesPerImport: Infinity, maxTablesPerImport: Infinity, maxTweetsPerImport: Infinity, appendSignature: false });
		const limited = { ...parsed, segments };
		const estimate = shared.articleMediaEstimate(limited, { setCover: true });
		if (estimate.overSoftLimit) throw new Error(t('图片、视频、表格和图表共 {0} 项，超过 X 文章稳妥的 {1} 项，请删减后再发', [estimate.total, shared.ARTICLE_MEDIA_POLICY.limit]));
		check();
		if (!(await waitForMainReady())) throw new Error('X 编辑器桥接没有就绪，请刷新 X 页面后重试');

		const lookup = (source: string, fallback: string): Prepared => {
			const found = prepared.get(source);
			if (found?.ok && found.base64 && shared.isSupportedMediaMime(found.mime || '')) return { ...found, fileName: safeName(found.fileName, fallback, found.mime || 'image/png'), source };
			if (source.startsWith('data:')) { const data = shared.parseDataUri(source); if (data.ok) return { ...data, ok: true, fileName: `${fallback}.${extFor(data.mime || 'image/png')}`, source }; }
			return { ok: false, error: found?.error || '图片没有准备好', source };
		};
		const images = segments.filter(segment => (segment.type === 'image' || segment.type === 'video'));
		const imageMap = new Map(images.map((segment, index) => [segment, lookup(String(segment.source), `image-${index + 1}`)] as const));
		let coverSource = limited.cover || '';
		if (coverSource) {
			const coverFile = lookup(coverSource, 'cover');
			if (coverFile.ok && (!shared.isSupportedImageMime(coverFile.mime || '') || coverFile.mime === 'image/gif')) {
				if (limited.meta.cover || limited.meta.Cover || limited.meta['封面']) throw new Error(t('封面需要静态图片，请另选一张图片'));
				// The automatic cover must not turn a GIF/video into a still frame.
				coverSource = images.find(segment => { const media = imageMap.get(segment); return media?.ok && shared.isSupportedImageMime(media.mime || '') && media.mime !== 'image/gif'; })?.source || '';
				limited.cover = coverSource || null;
			}
		}
		const coverSegment = coverSource && !segments.some(segment => (segment.type === 'image' || segment.type === 'video') && shared.imageSourcesMatch(String(segment.source), coverSource)) ? { type: 'image' as const, source: coverSource, alt: 'cover' } : null;
		const coverResult = coverSegment ? lookup(coverSource, 'cover') : null;
		const tables = segments.filter(segment => segment.type === 'table');
		const tableMap = new Map<any, any>();
		if (tables.length) say(`正在把 ${tables.length} 个表格转成图片…`);
		for (const [index, table] of tables.entries()) { check(); try { tableMap.set(table, await whileActive(shared.renderTableImage(table, `table-${index + 1}.png`), state.controller?.signal || new AbortController().signal)); } catch (error) { tableMap.set(table, { ok: false, error: (error as Error).message }); } }
		const failed = [...imageMap.values(), ...tableMap.values(), ...(coverResult ? [coverResult] : [])].filter(item => !item?.ok);
		if (failed.length) throw new Error(`有 ${failed.length} 张图片没能准备好：${failed[0].error || '未知原因'}。已停止，没有写入 X。`);
		check();
		say('正在打开新文章…');
		if (!state.resume) await ensureFreshEditor(state.controller?.signal, state.forceNew);
		else if (!isEditorRoute()) throw new Error(t('原草稿已不在当前页面，请先打开原草稿再继续'));
		check();

		const plan = shared.buildPastePlan(segments, imageMap, tableMap, { coverSource, coverResult });
		const files = new Map<string, unknown>();
		for (const [index,item] of (plan.plan || []).entries()) {
			if (item?.op?.type !== 'image' || !item.op.file?.base64) continue;
			const token=`media-${index}`; files.set(token, item.op.file);
			item.op.file = { token, mime: item.op.file.mime, fileName: item.op.file.fileName, alt: item.op.file.alt || '', bytes: item.op.file.bytes || null };
		}
		plan.sourceMarkdown = markdown; plan.resume = Boolean(state.resume);
		plan.title = limited.title || null; plan.cover = limited.cover || null; plan.origin = 'qiaomu-write';
		say('正在写入 X 编辑器…');
		const main = await runMain(plan, files, text => say(text), state.controller?.signal);
		const summary = { title: limited.title, main, elapsedMs: Math.round(performance.now() - started), articleId: articleIdFromUrl(), url: location.href.split('#')[0] };
		const imageFailures = Number(main?.imgFail || 0) + Number(main?.atomicFail || 0);
		const message = imageFailures ? `草稿已写入，但有 ${imageFailures} 处图片或特殊块没能放进去，请在 X 里检查。` : '草稿已写入，请在 X 里检查后再发布。';
		say(message, imageFailures ? 'warn' : 'done');
		post({ type: 'done', summary, message });
	} catch (error) {
		const e = error as Cancelled & { mainSummary?: unknown };
		state.recovery = e.recovery;
		if (e?.cancelled || state.cancel) { say(e.stopUnconfirmed ? t('停止请求已发送，请先检查 X 草稿后再重试。') : '已停止写入', e.stopUnconfirmed ? 'error' : 'warn'); post({ type: 'cancelled', recovery: e.recovery, stopUnconfirmed: e.stopUnconfirmed }); return; }
		say(e?.message || '写入失败', 'error');
		post({ type: 'error', error: e?.message || String(error), recovery: e.recovery });
	}
}

if (!window.__qiaomuWriteXContentV2?.alive()) {
	try { window.__qiaomuWriteXContentV2?.dispose(); } catch { /* invalidated runtime */ }
	const runtime = chrome.runtime;
	const onConnect: Parameters<typeof runtime.onConnect.addListener>[0] = port => {
		if (port.name !== PORT_NAME) return;
		const prepared = new Map<string, Prepared>();
		const state: ImportState = { cancel: false, owner: crypto.randomUUID() };
		state.retry = resume => { if(!busy&&!activeImport)post({type:resume?'resume-request':'retry-request'}); };
		state.dismiss = () => post({type:'dismiss'});
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the writer page closed */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: isArticleRoute(), editor: !!editor() });
			else if (message?.type === 'image') prepared.set(String(message.source), { ok: true, base64: message.base64, mime: message.mime, fileName: message.fileName, bytes: message.bytes, source: message.source });
			else if (message?.type === 'imageError') prepared.set(String(message.source), { ok: false, error: message.error, source: message.source });
			else if (message?.type === 'cancel') { state.cancel = true; state.controller?.abort(); }
			else if (message?.type === 'run' && !busy) {
				if (activeImport) { post({ type: 'error', error: t('X 正在处理上一次写入，请稍后重试') }); return; }
				busy = true; state.cancel = false; state.resume=Boolean(message.resume); state.forceNew=Boolean(message.forceNew); state.recovery=undefined; state.controller = new AbortController(); activeImport = state;
				void runImport(String(message.markdown || ''), prepared, post, state).finally(() => { busy = false; prepared.clear(); if (activeImport === state) activeImport = undefined; });
			}
		});
		port.onDisconnect.addListener(() => { const card=document.getElementById(STATUS_ID); if(card && card.dataset.owner===state.owner)card.querySelectorAll<HTMLButtonElement>('[data-recovery-action]').forEach(button=>button.disabled=true); state.retry=undefined; state.cancel = true; state.controller?.abort(); prepared.clear(); });
	};
	runtime.onConnect.addListener(onConnect);
	window.__qiaomuWriteXContentV2 = {
		alive: () => { try { return Boolean(runtime.id && runtime.getManifest()); } catch { return false; } },
		dispose: () => { activeImport?.controller?.abort(); runtime.onConnect.removeListener(onConnect); },
	};
}
