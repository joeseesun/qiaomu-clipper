import browser from './browser-polyfill';
import { asrProbe, type AsrReply, type WebInfo, type CookieBrowser } from './asr-client';
import { probeChannelsStudy } from './channels-study';
import { siteOf } from './study-sites';
import { probeWebStudy } from './web-study-probe';
import { t } from './ui-text';

// Extract exactly one link from a share message. Never carry its password or
// surrounding message into the reader URL, recent history or native requests.
export function sharedStudyAddress(input: string): string | undefined {
	const text = input.trim(); if (!text || text.length > 16000) return;
	if (!/\s/.test(text) && !text.startsWith('[') && !text.includes('：')) return text;
	const links = text.match(/https?:\/\/[^\s<>"\]\)（），。；！]+/gi);
	const unique = [...new Set(links?.map(link => link.replace(/[.,;!]+$/, '')) || [])];
	if (unique.length !== 1) return;
	return unique[0];
}
export const isProtectedStudy = (url: string): boolean => ['xiaoe', 'channels'].includes(siteOf(url)?.id || '');
export type ProtectedPage = { state: 'ready' | 'wechat' | 'password' | 'login' | 'opening' | 'live' | 'loading' | 'unavailable'; url?: string };

// The mini-program handoff explicitly supplies its normal H5 course URL.
// Accept only this shop and this resource; do not construct or guess an access URL.
export function xiaoeWebEntry(address: string): string | undefined {
 try {
  if (address.length > 12000) return;
  const page = new URL(address), app = page.hostname.match(/^([a-z0-9]+)\.mp\.xiaoeknow\.com$/)?.[1];
  if (!app || page.protocol !== 'https:' || page.username || page.password || (page.port && page.port !== '443') || page.searchParams.getAll('params').length !== 1) return;
  const encoded = page.searchParams.get('params')!; if (encoded.length > 8000) return;
  const params = JSON.parse(atob(encoded));
  if (params.app_id !== app || typeof params.resource_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(params.resource_id) || typeof params.h5_url !== 'string') return;
  const h5 = new URL(params.h5_url);
  if (h5.protocol !== 'https:' || h5.hostname !== `${app}.h5.xiaoeknow.com` || h5.username || h5.password || (h5.port && h5.port !== '443') || h5.hash || h5.searchParams.getAll('app_id').length !== 1 || h5.searchParams.get('app_id') !== app || Array.from(h5.searchParams.keys()).some(k => k !== 'app_id')) return;
  if (!/^\/v[24]\/course\/(alive|video|audio)\/[A-Za-z0-9_-]+$/.test(h5.pathname) || h5.pathname.split('/').pop() !== params.resource_id) return;
  return h5.href;
 } catch { return; }
}

// Injected in the tab explicitly opened by the reader; self-contained.
// Return only a classification and URL, never page text, form values or cookies.
export function snapshotProtectedPage(): ProtectedPage {
	const visible = Array.from(document.querySelectorAll('video,audio')).filter(node => {
		const r = node.getBoundingClientRect(), css = getComputedStyle(node);
		return r.width > 0 && r.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
	}) as HTMLMediaElement[];
	if (visible.some(v => v.duration === Infinity)) return { state: 'live' };
	if (visible.some(v => Number.isFinite(v.duration) && v.duration > 0 && v.readyState >= 1)) return { state: 'ready', url: location.href };
	const text = document.body?.innerText || document.body?.textContent || '';
	if (/扫码.*微信|微信.*扫码|微信[内內]打开|微信[内內]開啟|微信.*掃描|(?:scan.*(?:QR|WeChat)|(?:open|watch).*WeChat)|前往微信.*(?:观看|打开)|可前往微信观看/.test(text)) return { state: 'wechat' };
	if (document.querySelector('input[type="password"]') || /(?:输入|直播|访问)密码/.test(text)) return { state: 'password' };
	if (/验证码登录|请输入手机号|手机号登录|扫码登录/.test(text)) return { state: 'login' };
	return { state: visible.length ? 'loading' : 'unavailable' };
}

// A reader may inspect only the tab it explicitly opened, within the same
// platform. A missing service-worker session requires reopening, not borrowing
// an unrelated course tab. No media URLs or page HTML are returned.
export function protectedPageBridge(api: {
	create(options: { url: string }): Promise<{ id?: number }>;
	get(id: number): Promise<{ url?: string }>;
	update(id: number, options: { url: string }): Promise<unknown>;
	inspect(id: number): Promise<ProtectedPage>;
}) {
	const sessions = new Map<number, { owner: number; platform: string; opened: number }>();
	return async (owner: number, request: { mode?: string; url?: string; tabId?: number }): Promise<{ tabId?: number } | ProtectedPage> => {
		if (!Number.isInteger(owner) || owner < 0 || !request.url || !isProtectedStudy(request.url)) return { state: 'unavailable' };
		let url: URL; try { url = new URL(request.url); } catch { return { state: 'unavailable' }; }
		if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return { state: 'unavailable' };
		const platform = siteOf(url.href)!.id;
		if (request.mode === 'open') {
			for (const [id, entry] of sessions) if (entry.owner === owner || Date.now() - entry.opened > 2 * 3600000) sessions.delete(id);
			const tab = await api.create({ url: url.href });
			if (tab.id === undefined) return { state: 'unavailable' };
			sessions.set(tab.id, { owner, platform, opened: Date.now() }); return { tabId: tab.id };
		}
		const entry = sessions.get(request.tabId!);
		if (request.mode !== 'read' || !entry || entry.owner !== owner || entry.platform !== platform || Date.now() - entry.opened > 2 * 3600000) return { state: 'unavailable' };
		try {
			const tab = await api.get(request.tabId!), current = new URL(tab.url || '');
			if (!isProtectedStudy(current.href) || siteOf(current.href)?.id !== platform || current.protocol !== 'https:' || current.username || current.password || (current.port && current.port !== '443')) return { state: 'unavailable' };
			const web = xiaoeWebEntry(current.href);
			if (web) { if ((await api.get(request.tabId!)).url !== current.href) return { state: 'unavailable' }; await api.update(request.tabId!, { url: web }); return { state: 'opening' }; }
			const answer = await api.inspect(request.tabId!);
			if (answer.state === 'ready' && answer.url !== current.href) return { state: 'unavailable' }; // navigation raced inspection
			return answer;
		} catch { return { state: 'unavailable' }; }
	};
}

export async function probeProtectedStudy(url: string, status: HTMLElement, holder: HTMLElement,
	request: (message: object) => Promise<{ tabId?: number } | ProtectedPage> = message => browser.runtime.sendMessage(message),
	probe: typeof asrProbe = asrProbe): Promise<{ info: AsrReply<WebInfo>; cookies?: CookieBrowser; sourceUrl?: string }> {
	if (siteOf(url)?.id === 'channels') return probeChannelsStudy(url, status, holder, request as Parameters<typeof probeChannelsStudy>[3]);
	const doc = holder.ownerDocument, row = doc.createElement('div'); row.className = 'qiaomu-web-retry'; row.setAttribute('role', 'group');
	const heading = doc.createElement('b'); heading.textContent = siteOf(url)?.name || '';
	const note = doc.createElement('p'); note.textContent = t('请在原网页完成登录或输入访问密码，确认视频能在电脑浏览器播放，再回来重新读取。密码只在原网站输入。');
	const open = doc.createElement('button'); open.type = 'button'; open.className = 'qw-primary'; open.textContent = t('打开原页面');
	const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'qw-secondary'; retry.textContent = t('重新读取'); retry.disabled = true;
	const file = doc.createElement('a'); file.href = browser.runtime.getURL('reader.html?study=file'); file.className = 'qw-secondary'; file.textContent = t('选择本地文件');
	// Internal study navigation must not enter the ordinary article reader's delegated link handler.
	file.addEventListener('click', event => event.stopPropagation());
	const actions = doc.createElement('div'); actions.className = 'qiaomu-web-retry-actions'; actions.append(open, retry, file); row.append(heading, note, actions); holder.append(row); status.textContent = '';
	let tabId: number | undefined;
	open.addEventListener('click', async () => {
		open.disabled = true;
		try {
			const result = await request({ action: 'qiaomuProtectedStudyPage', mode: 'open', url });
			if ('tabId' in result && Number.isInteger(result.tabId)) { tabId = result.tabId; retry.disabled = false; }
			else note.textContent = t('原网页不可用，请重新打开后再读取。');
		} catch { note.textContent = t('原网页不可用，请重新打开后再读取。'); }
		finally { open.disabled = false; }
	});
	return new Promise(resolve => {
		retry.addEventListener('click', async () => {
			retry.disabled = true; open.disabled = true;
			try {
				const page = await request({ action: 'qiaomuProtectedStudyPage', mode: 'read', url, tabId }) as ProtectedPage;
				if (page?.state !== 'ready' || !page.url) {
					note.textContent = page?.state === 'wechat' ? t('这个分享页只支持在微信观看，电脑网页没有可读取的视频。请使用你已获授权保存的音视频文件转写。')
						: page?.state === 'live' ? t('这是仍在进行的直播，请等回放可用后重试，或导入已保存的音视频文件。')
						: page?.state === 'password' ? t('请先在原网页输入访问密码，再回来重新读取。')
						: ['login', 'opening'].includes(page?.state) ? t('请在原网页完成登录或输入访问密码，确认视频能在电脑浏览器播放，再回来重新读取。密码只在原网站输入。') : t('原网页不可用，请重新打开后再读取。');
					return;
				}
				let info = await probe(page.url);
				if (!info.ok && info.error === 'needs-cookies') {
					const result = await probeWebStudy(page.url, status, holder, probe);
					if (result.info.ok) { row.remove(); resolve({ ...result, sourceUrl: page.url }); return; }
					info = result.info;
				}
				if (info.ok || ['helper-offline', 'helper-outdated', 'missing'].includes(info.error)) { row.remove(); resolve({ info, sourceUrl: page.url }); return; }
				note.textContent = t('下载工具仍无法读取这条内容，请使用你已获授权保存的音视频文件转写。');
			} catch { note.textContent = t('原网页不可用，请重新打开后再读取。'); }
			finally { retry.disabled = false; open.disabled = false; }
		});
	});
}
