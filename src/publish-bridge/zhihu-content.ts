// Runs inside a Zhihu write-article tab (injected when Obsidian hands over an article). Because it runs in the page, every request
// carries the page's own origin and the person's login. It creates a draft, uploads the pictures and fills in the body.
import { md5Hex } from './md5';
import { assetSources, toZhihuHtml } from './zhihu-html';

const PORT_NAME = 'qiaomu-publish-zhihu';
const API = 'https://zhuanlan.zhihu.com/api';
declare global { interface Window { __qiaomuPublishZhihu?: boolean } }

interface Picture { base64: string; mime: string; fileName: string; bytes: number }
class Stopped extends Error { stopped = true; }

const decode = (base64: string): Uint8Array => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

function headers(json = false): Record<string, string> {
	const result: Record<string, string> = { 'x-requested-with': 'fetch' };
	const xsrf = /(?:^|;\s*)_xsrf=([^;]+)/.exec(document.cookie)?.[1];
	if (xsrf) result['x-xsrftoken'] = decodeURIComponent(xsrf);
	if (json) result['content-type'] = 'application/json';
	return result;
}

async function fail(response: Response, what: string): Promise<never> {
	const text = (await response.text().catch(() => '')).slice(0, 160);
	throw new Error(`${what}失败（${response.status}）${text ? `：${text}` : ''}`);
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)));
	let binary = '';
	signature.forEach(byte => { binary += String.fromCharCode(byte); });
	return btoa(binary);
}

// Aliyun OSS signature v1 (https://www.alibabacloud.com/help/en/oss/developer-reference/include-signatures-in-the-authorization-header).
async function putToOss(objectKey: string, bytes: Uint8Array, mime: string, token: { access_id: string; access_key: string; access_token: string }): Promise<void> {
	const date = new Date().toUTCString();
	const oss: Record<string, string> = { 'x-oss-date': date, 'x-oss-security-token': token.access_token, 'x-oss-user-agent': 'aliyun-sdk-js/6.8.0' };
	const canonical = Object.keys(oss).sort().map(name => `${name}:${oss[name]}`).join('\n');
	const toSign = `PUT\n\n${mime}\n${date}\n${canonical}\n/zhihu-pics/${objectKey}`;
	const signature = await hmacSha1Base64(token.access_key, toSign);
	const response = await fetch(`https://zhihu-pics-upload.zhimg.com/${objectKey}`, { method: 'PUT', headers: { 'content-type': mime, authorization: `OSS ${token.access_id}:${signature}`, ...oss }, body: bytes });
	if (!response.ok) await fail(response, '上传图片');
}

async function uploadPicture(picture: Picture): Promise<string> {
	const bytes = decode(picture.base64);
	const registered = await fetch('https://api.zhihu.com/images', { method: 'POST', credentials: 'include', headers: headers(true), body: JSON.stringify({ image_hash: md5Hex(bytes), source: 'article' }) });
	if (!registered.ok) await fail(registered, '登记图片');
	const data = await registered.json() as { upload_file: { state: number; image_id: string; object_key: string }; upload_token: { access_id: string; access_key: string; access_token: string } };
	if (data.upload_file.state === 1) {
		for (let attempt = 0; attempt < 10; attempt++) {
			const detail = await fetch(`https://api.zhihu.com/images/${data.upload_file.image_id}`, { credentials: 'include', headers: headers() });
			const info = await detail.json().catch(() => ({})) as { status?: string; original_hash?: string };
			if (info.original_hash) return `https://pic4.zhimg.com/${info.original_hash}`;
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		throw new Error('知乎处理图片超时');
	}
	await putToOss(data.upload_file.object_key, bytes, picture.mime || 'application/octet-stream', data.upload_token);
	return `https://pic4.zhimg.com/${data.upload_file.object_key}${picture.mime === 'image/gif' ? '.gif' : ''}`;
}

async function runImport(message: { title: string; html: string; cover: string; summary: string }, pictures: Map<string, Picture>, post: (message: unknown) => void, state: { cancel: boolean }): Promise<void> {
	const say = (text: string) => post({ type: 'progress', text });
	const check = () => { if (state.cancel) throw new Stopped('已停止'); };
	try {
		check();
		say('正在检查知乎登录…');
		const me = await fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include', headers: headers() }).then(r => r.json()).catch(() => ({})) as { id?: string };
		if (!me.id) throw new Error('还没有登录知乎。请在这个浏览器里登录知乎，再回 Obsidian 重新发布。');
		check();

		say('正在创建草稿…');
		const created = await fetch(`${API}/articles/drafts`, { method: 'POST', credentials: 'include', headers: headers(true), body: JSON.stringify({ title: message.title, content: '', delta_time: 0 }) });
		if (!created.ok) await fail(created, '创建草稿');
		const draft = await created.json() as { id?: string | number };
		if (!draft.id) throw new Error('创建草稿失败：知乎没有返回草稿编号');
		const draftId = String(draft.id);
		check();

		const sources = new Set([...assetSources(message.html), ...(message.cover ? [message.cover] : [])]);
		const urls = new Map<string, string>();
		let done = 0;
		for (const source of sources) {
			check();
			say(`正在上传图片 ${++done}/${sources.size}…`);
			const picture = pictures.get(source);
			if (!picture) throw new Error('有图片没有准备好，已停止');
			urls.set(source, await uploadPicture(picture));
		}

		check();
		say('正在写入正文…');
		const content = toZhihuHtml(message.html, urls);
		const patched = await fetch(`${API}/articles/${draftId}/draft`, { method: 'PATCH', credentials: 'include', headers: headers(true), body: JSON.stringify({ title: message.title, content }) });
		if (!patched.ok) await fail(patched, '写入正文');
		check();
		let note = '草稿已写入知乎，请检查后再发布。';
		const cover = message.cover ? urls.get(message.cover) : '';
		if (cover) {
			const titled = await fetch(`${API}/articles/${draftId}/draft`, { method: 'PATCH', credentials: 'include', headers: headers(true), body: JSON.stringify({ titleImage: cover, isTitleImageFullScreen: false }) }).catch(() => null);
			if (!titled?.ok) note = '草稿已写入知乎，但题图没能设置，请在知乎里手动加。';
		}
		const url = `https://zhuanlan.zhihu.com/p/${draftId}/edit`;
		check();
		post({ type: 'done', summary: { url, remoteId: draftId }, message: note });
		window.setTimeout(() => { location.assign(url); }, 400);
	} catch (error) {
		if ((error as Stopped)?.stopped) { post({ type: 'cancelled' }); return; }
		post({ type: 'error', error: (error as Error).message || String(error) });
	}
}

if (!window.__qiaomuPublishZhihu) {
	window.__qiaomuPublishZhihu = true;
	chrome.runtime.onConnect.addListener(port => {
		if (port.name !== PORT_NAME) return;
		const pictures = new Map<string, Picture>();
		const state = { cancel: false };
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the extension went away */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: location.hostname === 'zhuanlan.zhihu.com' });
			else if (message?.type === 'image') pictures.set(String(message.source), { base64: message.base64, mime: message.mime, fileName: message.fileName, bytes: message.bytes });
			else if (message?.type === 'cancel') state.cancel = true;
			else if (message?.type === 'run' && !busy) { busy = true; void runImport(message, pictures, post, state).finally(() => { busy = false; }); }
		});
		port.onDisconnect.addListener(() => { state.cancel = true; });
	});
}
