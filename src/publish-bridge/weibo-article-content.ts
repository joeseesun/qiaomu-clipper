// Runs inside card.weibo.com (injected when Obsidian hands over a note). It uploads the pictures to Weibo's own picture API, then
// creates and saves a headline-article draft. Nothing is published: the person opens the editor and presses 发布 themselves.
// The endpoints follow Weibo's public editor AJAX calls; when they change, this file is the only place to update.
const PORT_NAME = 'qiaomu-publish-weibo-article';
declare global { interface Window { __qiaomuPublishWeiboArticle?: boolean } }

const SUCCESS_CODE = 100000;
const ENDPOINTS = [
	{
		version: 'v5',
		editorUrl: 'https://card.weibo.com/article/v5/editor',
		createUrl: 'https://card.weibo.com/article/v5/aj/editor/draft/create',
		saveUrl: 'https://card.weibo.com/article/v5/aj/editor/draft/save',
	},
	{
		version: 'v3',
		editorUrl: 'https://card.weibo.com/article/v3/editor',
		createUrl: 'https://card.weibo.com/article/v3/aj/editor/draft/create',
		saveUrl: 'https://card.weibo.com/article/v3/aj/editor/draft/save',
	},
];

interface Picture { base64: string; mime: string; fileName: string; bytes: number }
interface RunMessage { title: string; html: string; cover: string; summary: string }
interface Uploaded { pid: string; width: number; height: number }
class Stopped extends Error { stopped = true; }

const isEditorRoute = () => location.hostname === 'card.weibo.com';

const blobOf = (picture: Picture): Blob => {
	const bytes = Uint8Array.from(atob(picture.base64), char => char.charCodeAt(0));
	return new Blob([bytes], { type: picture.mime || 'image/jpeg' });
};

/** Reads the signed-in uid from the page's MAIN world by injecting a tiny script (isolated content scripts can't see page globals). */
function pageUid(): string {
	const probe = document.createElement('script');
	probe.textContent = `try{document.documentElement.setAttribute('data-qm-uid',String((window.ERR_UID)||(window.userInfo&&window.userInfo.uid)||(window.__WB_GET_CONFIG&&window.__WB_GET_CONFIG().config.uid)||''));}catch(e){}`;
	(document.head || document.documentElement).appendChild(probe);
	probe.remove();
	return document.documentElement.getAttribute('data-qm-uid') || '';
}

/** The signed-in account id. The v5 editor exposes it as `window.ERR_UID` / `window.userInfo.uid`; older pages used `$CONFIG['uid']`. */
async function accountId(): Promise<string> {
	const here = pageUid();
	if (here) return here;
	for (const endpoint of ENDPOINTS) {
		try {
			const response = await fetch(endpoint.editorUrl, { credentials: 'include' });
			if (!response.ok) continue;
			const text = await response.text();
			const match = text.match(/(?:\$CONFIG\['uid'\]|ERR_UID)\s*=\s*['"]?(\d+)/) || text.match(/"uid"\s*:\s*(\d+)/);
			if (match) return match[1];
		} catch { /* try the next version */ }
	}
	return '';
}

/** Posts the bytes to Weibo's picture API the same way the composer does, and returns the picture id. */
async function uploadPicture(picture: Picture): Promise<Uploaded | null> {
	const url = new URL('https://picupload.weibo.com/interface/pic_upload.php');
	url.searchParams.set('app', 'miniblog');
	url.searchParams.set('s', 'json');
	url.searchParams.set('p', '1');
	url.searchParams.set('data', '1');
	url.searchParams.set('url', 'weibo.com/ww');
	url.searchParams.set('markpos', '1');
	url.searchParams.set('logo', '1');
	url.searchParams.set('nick', 'ww');
	url.searchParams.set('file_source', '4');
	url.searchParams.set('_rid', String(Date.now()));
	try {
		const response = await fetch(url.toString(), { method: 'POST', body: blobOf(picture), credentials: 'include' });
		if (!response.ok) return null;
		const json = await response.json();
		const pic = json?.data?.pics?.pic_1;
		if (!pic?.pid) return null;
		return { pid: String(pic.pid), width: Number(pic.width) || 0, height: Number(pic.height) || 0 };
	} catch { return null; }
}

const assetOf = (src: string | null): string | null => (src?.startsWith('qp-asset://') ? src : null);

/** Replaces every inline `qp-asset://` image with the uploaded Weibo picture, keeping Weibo's figure/srcset shape. */
async function rewriteHtml(html: string, pictures: Map<string, Picture>, cache: Map<string, Uploaded>, say: (text: string) => void, check: () => void): Promise<string> {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const images = Array.from(doc.querySelectorAll('img'));
	for (const [index, image] of images.entries()) {
		check();
		const asset = assetOf(image.getAttribute('src'));
		if (!asset) continue;
		const picture = pictures.get(asset);
		if (!picture) throw new Error(`正文里第 ${index + 1} 张图片没有准备好`);
		let uploaded = cache.get(asset);
		if (!uploaded) {
			say(`正在上传正文图片 ${index + 1}/${images.length}…`);
			const result = await uploadPicture(picture);
			if (!result) throw new Error(`第 ${index + 1} 张图片上传失败，请确认已登录微博`);
			cache.set(asset, result);
			uploaded = result;
		}
		const figure = doc.createElement('figure');
		figure.className = 'image';
		const replacement = doc.createElement('img');
		replacement.setAttribute('src', `https://wx2.sinaimg.cn/large/${uploaded.pid}.jpg`);
		replacement.setAttribute('alt', picture.fileName || '图片');
		replacement.setAttribute('srcset', [
			`https://wx2.sinaimg.cn/bmiddle/${uploaded.pid}.jpg 440w`,
			`https://wx2.sinaimg.cn/mw690/${uploaded.pid}.jpg 690w`,
			`https://wx2.sinaimg.cn/mw1024/${uploaded.pid}.jpg 1024w`,
			`https://wx2.sinaimg.cn/large/${uploaded.pid}.jpg 2048w`,
		].join(', '));
		replacement.setAttribute('sizes', '100vw');
		if (uploaded.width && uploaded.height) {
			replacement.setAttribute('aspect', String(uploaded.width / uploaded.height));
			replacement.setAttribute('width', String(uploaded.width));
		}
		figure.appendChild(replacement);
		image.replaceWith(figure);
	}
	// Strip any wiki / Markdown image markers that survived rendering (e.g. `![[name.png]]` or `![alt](url)`).
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	let textNode: Node | null;
	while ((textNode = walker.nextNode())) {
		const text = textNode.textContent || '';
		if (/!\[\[|\!\[/.test(text)) {
			textNode.textContent = text.replace(/!\[\[[^\]]*\]\]/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
		}
	}
	return doc.body.innerHTML;
}

function draftForm(message: RunMessage, content: string, cover: string, draftId: string, account: string, version: string): FormData {
	const form = new FormData();
	form.append('title', message.title.slice(0, 32));
	form.append('type', '');
	form.append('summary', message.summary.slice(0, 44));
	form.append('writer', '');
	form.append('cover', cover);
	form.append('content', content);
	form.append('collection', JSON.stringify([]));
	form.append('updated', new Date().toISOString());
	form.append('id', draftId);
	form.append('subtitle', '');
	form.append('extra', 'null');
	form.append('status', '0');
	form.append('publish_at', '');
	form.append('error_msg', '');
	form.append('error_code', '0');
	form.append('free_content', '');
	form.append('is_word', '0');
	form.append('article_recommend', JSON.stringify({}));
	form.append('publish_local_at', '');
	form.append('timestamp', '');
	form.append('is_article_free', '0');
	form.append('only_render_h5', '0');
	form.append('is_ai_plugins', '0');
	form.append('is_aigc_used', '0');
	form.append('is_v4', '0');
	form.append('follow_to_read', '1');
	form.append('follow_to_read_detail[result]', '1');
	form.append('follow_to_read_detail[x]', '0');
	form.append('follow_to_read_detail[y]', '0');
	form.append('follow_to_read_detail[readme_link]', 'http://t.cn/A6UnJsqW');
	form.append('follow_to_read_detail[level]', '');
	form.append('follow_to_read_detail[daily_limit]', '1');
	form.append('follow_to_read_detail[daily_limit_notes]', '非认证用户单日仅限1篇文章使用');
	form.append('follow_to_read_detail[show_level_tips]', '0');
	form.append('isreward', '0');
	form.append('isreward_tips', '');
	form.append('isreward_tips_url', `https://card.weibo.com/article/${version}/aj/editor/draft/applyisrewardtips?uid=${account}`);
	form.append('pay_setting', JSON.stringify([]));
	form.append('source', '0');
	form.append('action', '0');
	form.append('is_single_pay_new', '');
	form.append('money', '');
	form.append('is_vclub_single_pay', '');
	form.append('vclub_single_pay_money', '');
	form.append('content_type', '0');
	form.append('save', '1');
	form.append('wbeditorRef', '9');
	form.append('ver', '4.0');
	form.append('_rid', String(Date.now()));
	return form;
}

const postJson = async (url: string, init: RequestInit): Promise<{ ok: boolean; json?: any }> => {
	try {
		const response = await fetch(url, { ...init, credentials: 'include' });
		if (!response.ok) return { ok: false };
		return { ok: true, json: await response.json() };
	} catch { return { ok: false }; }
};

async function createDraft(endpoint: typeof ENDPOINTS[number], account: string): Promise<string | null> {
	const url = new URL(endpoint.createUrl);
	url.searchParams.set('uid', account);
	url.searchParams.set('_rid', String(Date.now()));
	const result = await postJson(url.toString(), { method: 'POST' });
	const id = result.ok ? result.json?.data?.id : null;
	return id ? String(id) : null;
}

async function saveDraft(endpoint: typeof ENDPOINTS[number], message: RunMessage, content: string, cover: string, draftId: string, account: string): Promise<string | null> {
	const url = new URL(endpoint.saveUrl);
	url.searchParams.set('uid', account);
	url.searchParams.set('id', draftId);
	url.searchParams.set('_rid', String(Date.now()));
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const result = await postJson(url.toString(), { method: 'POST', body: draftForm(message, content, cover, draftId, account, endpoint.version) });
		if (result.ok && result.json?.code === SUCCESS_CODE) return draftId;
		if (!result.ok) continue;
		return null;
	}
	return null;
}

async function runFill(message: RunMessage, pictures: Map<string, Picture>, post: (message: unknown) => void, state: { cancel: boolean }): Promise<void> {
	const say = (text: string) => post({ type: 'progress', text });
	const check = () => { if (state.cancel) throw new Stopped('已停止'); };
	try {
		check();
		if (!isEditorRoute()) throw new Error('这个标签页不是微博长文编辑器，请先登录微博');
		if (!message.html?.trim()) throw new Error('这篇笔记没有可写入的正文');
		say('正在确认微博账号…');
		const account = await accountId();
		if (!account) throw new Error('没拿到微博账号信息，请确认已登录微博后重试');
		check();

		const cache = new Map<string, Uploaded>();
		say('正在处理正文图片…');
		const content = await rewriteHtml(message.html, pictures, cache, say, check);
		check();

		let cover = '';
		const coverAsset = assetOf(message.cover);
		if (coverAsset) {
			say('正在上传封面…');
			const picture = pictures.get(coverAsset);
			if (!picture) throw new Error('封面图片没有准备好');
			const uploaded = await uploadPicture(picture);
			if (!uploaded) throw new Error('封面上传失败，请确认已登录微博');
			cover = `https://wx2.sinaimg.cn/large/${uploaded.pid}.jpg`;
		}
		check();

		for (const endpoint of ENDPOINTS) {
			say(`正在写入微博长文草稿（${endpoint.version}）…`);
			const draftId = await createDraft(endpoint, account);
			if (!draftId) continue;
			const saved = await saveDraft(endpoint, message, content, cover, draftId, account);
			if (saved) {
				const draftUrl = `${endpoint.editorUrl}#/draft/${saved}`;
				try { location.hash = `#/draft/${saved}`; } catch { /* SPA may have its own router */ }
				post({ type: 'done', summary: { url: draftUrl }, message: '草稿已写入微博长文，请在微博编辑器里检查后发布。' });
				return;
			}
			throw new Error('草稿保存失败，微博接口可能已变动，请把内容手动粘贴到微博长文编辑器。');
		}
		throw new Error('没能创建微博长文草稿，微博接口可能已变动。');
	} catch (error) {
		if ((error as Stopped)?.stopped) { post({ type: 'cancelled' }); return; }
		post({ type: 'error', error: (error as Error).message || String(error) });
	}
}

if (!window.__qiaomuPublishWeiboArticle) {
	window.__qiaomuPublishWeiboArticle = true;
	chrome.runtime.onConnect.addListener(port => {
		if (port.name !== PORT_NAME) return;
		const pictures = new Map<string, Picture>();
		const state = { cancel: false };
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the extension went away */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: isEditorRoute() });
			else if (message?.type === 'image') pictures.set(String(message.source), { base64: message.base64, mime: message.mime, fileName: message.fileName, bytes: message.bytes });
			else if (message?.type === 'cancel') state.cancel = true;
			else if (message?.type === 'run' && !busy) { busy = true; void runFill(message, pictures, post, state).finally(() => { busy = false; }); }
		});
		port.onDisconnect.addListener(() => { state.cancel = true; });
	});
}

export {};
