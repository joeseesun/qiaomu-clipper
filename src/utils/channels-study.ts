import browser from './browser-polyfill';
import type { WebInfo } from './asr-client';
import { t } from './ui-text';

export function channelsShareAddress(address: string): string | undefined {
 try {
  const u = new URL(address); if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.hash) return;
  const id = u.hostname === 'weixin.qq.com' && !u.search ? u.pathname.match(/^\/sph\/([A-Za-z0-9]{3,64})\/?$/)?.[1]
   : u.hostname === 'channels.weixin.qq.com' && u.pathname === '/finder-preview/pages/sph' && Array.from(u.searchParams.keys()).join(',') === 'id' ? u.searchParams.get('id') : undefined;
  if (id && /^[A-Za-z0-9]{3,64}$/.test(id)) return `https://weixin.qq.com/sph/${id}`;
 } catch { /* not a share address */ }
}
export function isChannelsMedia(page: string, media: unknown): media is string {
 if (!channelsShareAddress(page) || typeof media !== 'string' || media.length > 8000) return false;
 try { const u = new URL(media); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && !u.hash && u.hostname === 'finder.video.qq.com' && /^\/(?:\d+\/){2}stodownload$/.test(u.pathname); } catch { return false; }
}
export type ChannelsResult = { state: 'ready'; info: WebInfo; sourceUrl: string } | { state: 'login' | 'loading' | 'unavailable' };
type ParsedShare = { state: 'ready'; playbackUrl: string } | { state: 'login' | 'unavailable' };
const playbackAddress = (address: string): boolean => {
 try { const u = new URL(address); return u.protocol === 'https:' && u.hostname === 'channels.weixin.qq.com' && u.pathname === '/finder-preview/pages/feed' && !u.username && !u.password && (!u.port || u.port === '443') && !u.hash && !!u.searchParams.get('token') && !!u.searchParams.get('eid'); } catch { return false; }
};

// Serialized into the user-opened Yuanbao tab. Do not use async/await (ES6 build).
// Its login stays on Yuanbao; only the selected share URL is posted.
export function parseChannelsShare(address: string): Promise<ParsedShare> {
 if (location.origin !== 'https://yuanbao.tencent.com' || !/^https:\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9]{3,64}$/.test(address)) return Promise.resolve({ state: 'unavailable' });
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
 return fetch('/api/weixin/get_parse_result', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'video_channel_url', url: address, scene: 1 }) })
  .then<ParsedShare>(response => response.status === 401 || response.status === 403 ? { state: 'login' as const } : !response.ok ? { state: 'unavailable' as const } : response.json().then(data => {
   const link = data?.data?.playable_url; if (typeof link !== 'string' || link.length > 8000 || data.code !== 0) return { state: 'unavailable' as const };
   const u = new URL(link);
   if (u.protocol !== 'https:' || u.hostname !== 'channels.weixin.qq.com' || u.pathname !== '/finder-preview/pages/feed' || u.username || u.password || (u.port && u.port !== '443') || u.hash || !u.searchParams.get('token') || !u.searchParams.get('eid')) return { state: 'unavailable' as const };
   return { state: 'ready' as const, playbackUrl: u.href };
  }))
  .catch(() => ({ state: 'unavailable' as const })).finally(() => clearTimeout(timer));
}
// Separate official playback tab: never forward Yuanbao's login or page HTML.
// The short-lived generalToken remains in this page and is never returned.
export function readChannelsPlayback(): Promise<{ state: 'ready'; info: WebInfo } | { state: 'loading' | 'unavailable' }> {
 const u = new URL(location.href);
 if (u.origin !== 'https://channels.weixin.qq.com' || u.pathname !== '/finder-preview/pages/feed' || !u.searchParams.get('token') || !u.searchParams.get('eid')) return Promise.resolve({ state: 'unavailable' });
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
 return fetch('/finder-preview/api/feed/get_feed_info', { method: 'POST', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseReq: { generalToken: u.searchParams.get('token') }, exportId: u.searchParams.get('eid') }) })
  .then(r => { if (!r.ok) throw Error('Playback unavailable'); return r.json(); }).then(data => {
   if (location.href !== u.href || data?.errCode !== 0 || data?.data?.errMsg?.type !== 0) return { state: 'unavailable' as const };
   const feed = data.data.feedInfo, media = feed?.h264VideoInfo?.videoUrl;
   if (typeof media !== 'string' || media.length > 8000) return { state: 'unavailable' as const };
   const src = new URL(media);
   if (src.protocol !== 'https:' || src.hostname !== 'finder.video.qq.com' || !/^\/(?:\d+\/){2}stodownload$/.test(src.pathname) || src.username || src.password || (src.port && src.port !== '443') || src.hash) return { state: 'unavailable' as const };
   const video = document.querySelector('video');
   const seconds = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
   const date = typeof feed.createtime === 'number' && feed.createtime > 0 && feed.createtime < 1e11 ? new Date(feed.createtime * 1000).toISOString().slice(0, 10) : null;
   return { state: 'ready' as const, info: { ok: true as const, title: String(feed.description || document.title).slice(0, 300), author: String(data.data.authorInfo?.nickname || '').slice(0, 120), seconds, thumbnail: typeof feed.coverUrl === 'string' && feed.coverUrl.startsWith('https://') ? feed.coverUrl : null, site: 'WeChat Channels', mediaUrl: media, video: true, description: String(feed.description || '').slice(0, 6000), date } };
  }).catch(() => ({ state: 'unavailable' as const })).finally(() => clearTimeout(timer));
}

export function channelsStudyBridge(api: {
 create(options: { url: string }): Promise<{ id?: number }>;
 get(id: number): Promise<{ url?: string; status?: string }>;
 parse(id: number, share: string): Promise<ParsedShare>;
 inspect(id: number): ReturnType<typeof readChannelsPlayback>;
}) {
 const sessions = new Map<number, { source: string; resolver: number; playback?: number; playbackUrl?: string; opened: number }>();
 return async (owner: number, request: { mode?: string; url?: string }): Promise<{ state: 'opened' } | ChannelsResult> => {
  const source = request.url && channelsShareAddress(request.url);
  if (!source || !Number.isInteger(owner) || owner < 0) return { state: 'unavailable' };
  if (request.mode === 'open') {
   const tab = await api.create({ url: 'https://yuanbao.tencent.com/' }); if (tab.id === undefined) return { state: 'unavailable' };
   for (const [key, value] of sessions) if (Date.now() - value.opened > 2 * 3600000) sessions.delete(key);
   sessions.set(owner, { source, resolver: tab.id, opened: Date.now() }); return { state: 'opened' };
  }
  const session = sessions.get(owner);
  if (request.mode !== 'read' || !session || session.source !== source || Date.now() - session.opened > 2 * 3600000) return { state: 'unavailable' };
  try {
   if (session.playback !== undefined && session.playbackUrl) {
    const tab = await api.get(session.playback);
    if (!tab.url || tab.url === 'about:blank' || tab.status === 'loading') return { state: 'loading' };
    if (tab.url !== session.playbackUrl || !playbackAddress(tab.url)) { session.playback = undefined; session.playbackUrl = undefined; return { state: 'unavailable' }; }
    const result = await api.inspect(session.playback);
    if ((await api.get(session.playback)).url !== session.playbackUrl) return { state: 'unavailable' };
    if (result.state === 'ready' && isChannelsMedia(source, result.info.mediaUrl)) { sessions.delete(owner); return { state: 'ready', info: result.info, sourceUrl: source }; }
    if (result.state === 'unavailable' || result.state === 'ready') { session.playback = undefined; session.playbackUrl = undefined; }
    return { state: result.state === 'ready' ? 'unavailable' : result.state };
   }
   const tab = await api.get(session.resolver);
   if (!tab.url || tab.url === 'about:blank' || tab.status === 'loading') return { state: 'loading' };
   if (!tab.url || new URL(tab.url).origin !== 'https://yuanbao.tencent.com') return { state: 'unavailable' };
   const parsed = await api.parse(session.resolver, source);
   if ((await api.get(session.resolver)).url !== tab.url) return { state: 'unavailable' };
   if (parsed.state !== 'ready') return parsed;
   if (!playbackAddress(parsed.playbackUrl)) return { state: 'unavailable' };
   const player = await api.create({ url: parsed.playbackUrl }); if (player.id === undefined) return { state: 'unavailable' };
   session.playback = player.id; session.playbackUrl = parsed.playbackUrl; return { state: 'loading' };
  } catch { session.playback = undefined; session.playbackUrl = undefined; return { state: 'unavailable' }; }
 };
}

export function probeChannelsStudy(url: string, status: HTMLElement, holder: HTMLElement,
 request: (message: object) => Promise<{ state?: string; info?: WebInfo; sourceUrl?: string }> = message => browser.runtime.sendMessage(message)): Promise<{ info: WebInfo; sourceUrl: string }> {
 const doc = holder.ownerDocument, row = doc.createElement('div'); row.className = 'qiaomu-web-retry';
 const heading = doc.createElement('b'); heading.textContent = t('视频号');
 const note = doc.createElement('p'); note.textContent = t('此链接需要腾讯元宝解析。点击后将打开元宝；登录后仅将这条链接交给元宝解析，登录信息不会交给字幕识别服务。');
 const open = doc.createElement('button'); open.type = 'button'; open.className = 'qw-primary'; open.textContent = t('打开元宝并验证');
 const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'qw-secondary'; retry.textContent = t('重新读取'); retry.disabled = true;
 const actions = doc.createElement('div'); actions.className = 'qiaomu-web-retry-actions'; actions.append(open, retry); row.append(heading, note, actions); holder.append(row); status.textContent = '';
 return new Promise(resolve => {
  let done = false, busy = false, opened = false, timer: number | undefined, deadline = 0, failures = 0;
  const win = doc.defaultView!;
  const stop = () => { win.clearTimeout(timer); timer = undefined; };
  win.addEventListener('pagehide', () => { done = true; stop(); }, { once: true });
  const attempt = async () => {
   if (busy || done || !opened) return;
   busy = true; open.disabled = true; retry.disabled = true;
   try {
    const result = await request({ action: 'qiaomuChannelsStudy', mode: 'read', url });
    if (done) return;
    if (result.state === 'ready' && result.info && result.sourceUrl) { done = true; stop(); row.remove(); resolve({ info: result.info, sourceUrl: result.sourceUrl }); return; }
    failures = result.state === 'unavailable' ? failures + 1 : 0;
    note.textContent = result.state === 'login' ? t('元宝已打开，登录完成后这里会自动继续；也可以点「重新读取」。') : result.state === 'loading' ? t('官方播放页正在加载，取得视频后会自动继续，请稍候。') : t('原网页不可用，请重新打开后再读取。');
   } catch { failures++; note.textContent = t('原网页不可用，请重新打开后再读取。'); }
   finally { busy = false; if (!done) { retry.disabled = false; open.disabled = false; } }
  };
  const schedule = () => {
   stop(); if (done || failures >= 3) return;
   if (Date.now() >= deadline) { note.textContent = t('自动读取已暂停。请确认元宝已登录，然后点「重新读取」。'); return; }
   timer = win.setTimeout(() => { void attempt().then(schedule); }, 3000);
  };
  open.addEventListener('click', () => {
   if (busy || done) return;
   stop(); busy = true; open.disabled = true; retry.disabled = true; opened = false;
   void request({ action: 'qiaomuChannelsStudy', mode: 'open', url }).then(result => {
    if (done) return;
    if (result.state === 'opened') { opened = true; failures = 0; deadline = Date.now() + 180000; note.textContent = t('元宝已打开，登录完成后这里会自动继续；也可以点「重新读取」。'); schedule(); }
    else note.textContent = t('原网页不可用，请重新打开后再读取。');
   }).catch(() => { note.textContent = t('原网页不可用，请重新打开后再读取。'); }).finally(() => { busy = false; open.disabled = false; retry.disabled = !opened; });
  });
  retry.addEventListener('click', () => {
   stop(); failures = 0; deadline = Date.now() + 180000;
   void attempt().then(schedule);
  });
 });
}
