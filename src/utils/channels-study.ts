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
// The official playback page the user's own session opened (channels.weixin.qq.com/finder-preview/pages/feed?eid=…). The short-lived token is dropped:
// only the export id names the video, so the address is a stable key and never carries a credential.
export function channelsPlaybackPage(address: string): string | undefined {
 try {
  const u = new URL(address), eid = u.searchParams.get('eid');
  if (u.protocol !== 'https:' || u.hostname !== 'channels.weixin.qq.com' || u.pathname !== '/finder-preview/pages/feed' || u.username || u.password || (u.port && u.port !== '443') || !eid || eid.length > 200 || /[\u0000-\u001f\s]/.test(eid)) return;
  return `https://channels.weixin.qq.com/finder-preview/pages/feed?eid=${encodeURIComponent(eid)}`;
 } catch { /* not a playback page */ }
}
// A page the study pipeline may attach a Channels video to: a share address or its official playback page.
export const channelsStudyAddress = (address: string): string | undefined => channelsShareAddress(address) || channelsPlaybackPage(address);
export function isChannelsMedia(page: string, media: unknown): media is string {
 if (!channelsStudyAddress(page) || typeof media !== 'string' || media.length > 8000) return false;
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
 create(options: { url: string; active?: boolean }): Promise<{ id?: number }>;
 remove?(id: number): Promise<unknown>;
 update?(id: number, properties: { active: boolean }): Promise<unknown>;
 get(id: number): Promise<{ url?: string; status?: string }>;
 parse(id: number, share: string): Promise<ParsedShare>;
 inspect(id: number): ReturnType<typeof readChannelsPlayback>;
}) {
 const sessions = new Map<number, { source: string; resolver: number; playback?: number; playbackUrl?: string; opened: number; surfaced?: boolean }>();
 // Both tabs are ours: they work behind the study page and go away once the video is read, or when the study page leaves.
 const close = (session: { resolver: number; playback?: number }) => { for (const id of [session.playback, session.resolver]) if (id !== undefined) void api.remove?.(id)?.catch?.(() => {}); };
 return async (owner: number, request: { mode?: string; url?: string }): Promise<{ state: 'opened' } | ChannelsResult> => {
  const source = request.url && channelsShareAddress(request.url);
  if (!source || !Number.isInteger(owner) || owner < 0) return { state: 'unavailable' };
  if (request.mode === 'open') {
   const previous = sessions.get(owner); if (previous) { sessions.delete(owner); close(previous); }
   // Behind the study page: Yuanbao only comes forward when the viewer has to sign in.
   const tab = await api.create({ url: 'https://yuanbao.tencent.com/', active: false }); if (tab.id === undefined) return { state: 'unavailable' };
   for (const [key, value] of sessions) if (Date.now() - value.opened > 2 * 3600000) { sessions.delete(key); close(value); }
   sessions.set(owner, { source, resolver: tab.id, opened: Date.now() }); return { state: 'opened' };
  }
  if (request.mode === 'show') { const shown = sessions.get(owner); if (!shown || shown.source !== source) return { state: 'unavailable' }; void api.update?.(shown.resolver, { active: true })?.catch?.(() => {}); return { state: 'opened' }; }
  if (request.mode === 'cancel') { const gone = sessions.get(owner); if (gone) { sessions.delete(owner); close(gone); } return { state: 'unavailable' }; }
  const session = sessions.get(owner);
  if (request.mode !== 'read' || !session || session.source !== source || Date.now() - session.opened > 2 * 3600000) return { state: 'unavailable' };
  try {
   if (session.playback !== undefined && session.playbackUrl) {
    const tab = await api.get(session.playback);
    if (!tab.url || tab.url === 'about:blank' || tab.status === 'loading') return { state: 'loading' };
    if (tab.url !== session.playbackUrl || !playbackAddress(tab.url)) { session.playback = undefined; session.playbackUrl = undefined; return { state: 'unavailable' }; }
    const result = await api.inspect(session.playback);
    if ((await api.get(session.playback)).url !== session.playbackUrl) return { state: 'unavailable' };
    if (result.state === 'ready' && isChannelsMedia(source, result.info.mediaUrl)) { sessions.delete(owner); close(session); void api.update?.(owner, { active: true })?.catch?.(() => {}); return { state: 'ready', info: result.info, sourceUrl: source }; }
    if (result.state === 'unavailable' || result.state === 'ready') { session.playback = undefined; session.playbackUrl = undefined; }
    return { state: result.state === 'ready' ? 'unavailable' : result.state };
   }
   const tab = await api.get(session.resolver);
   if (!tab.url || tab.url === 'about:blank' || tab.status === 'loading') return { state: 'loading' };
   if (!tab.url || new URL(tab.url).origin !== 'https://yuanbao.tencent.com') return { state: 'unavailable' };
   const parsed = await api.parse(session.resolver, source);
   if ((await api.get(session.resolver)).url !== tab.url) return { state: 'unavailable' };
   if (parsed.state === 'login' && !session.surfaced) { session.surfaced = true; void api.update?.(session.resolver, { active: true })?.catch?.(() => {}); }
   if (parsed.state !== 'ready') return parsed;
   if (!playbackAddress(parsed.playbackUrl)) return { state: 'unavailable' };
   // The official page only lends its video: it opens behind the study page, which stays the viewer's place.
   const player = await api.create({ url: parsed.playbackUrl, active: false }); if (player.id === undefined) return { state: 'unavailable' };
   session.playback = player.id; session.playbackUrl = parsed.playbackUrl; return { state: 'loading' };
  } catch { session.playback = undefined; session.playbackUrl = undefined; return { state: 'unavailable' }; }
 };
}

export function probeChannelsStudy(url: string, status: HTMLElement, holder: HTMLElement,
 request: (message: object) => Promise<{ state?: string; info?: WebInfo; sourceUrl?: string }> = message => browser.runtime.sendMessage(message), autoOpen = true): Promise<{ info: WebInfo; sourceUrl: string }> {
 const doc = holder.ownerDocument, row = doc.createElement('div'); row.className = 'qiaomu-web-retry'; row.setAttribute('role', 'group');
 const heading = doc.createElement('b'); heading.textContent = t('视频号');
 // The viewer sees this page only: Yuanbao and the official player work in tabs behind it, and Yuanbao comes forward only to sign in.
 const steps = doc.createElement('ol'); steps.className = 'qiaomu-web-steps';
 const reading = doc.createElement('li'); reading.textContent = t('通过腾讯元宝读取视频'); reading.setAttribute('aria-current', 'step');
 const subtitles = doc.createElement('li'); subtitles.textContent = t('生成字幕'); steps.append(reading, subtitles);
 const note = doc.createElement('p'); note.setAttribute('role', 'status');
 const privacy = doc.createElement('p'); privacy.textContent = t('只把这条链接交给元宝解析，登录信息不会交给字幕识别服务。');
 const open = doc.createElement('button'); open.type = 'button'; open.className = 'qw-primary'; open.textContent = t('打开元宝登录页'); open.hidden = true;
 const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'qw-secondary'; retry.textContent = t('重新读取'); retry.hidden = true;
 const actions = doc.createElement('div'); actions.className = 'qiaomu-web-retry-actions'; actions.append(open, retry); row.append(heading, steps, note, privacy, actions); holder.append(row); status.textContent = '';
 return new Promise(resolve => {
  let done = false, busy = false, timer: number | undefined, deadline = 0, failures = 0;
  const win = doc.defaultView!;
  const stop = () => { win.clearTimeout(timer); timer = undefined; };
  const message = (mode: string) => request({ action: 'qiaomuChannelsStudy', mode, url });
  // Leaving this page takes the tabs it opened with it.
  win.addEventListener('pagehide', () => { if (done) return; done = true; stop(); void message('cancel').catch(() => {}); }, { once: true });
  const show = (state: 'loading' | 'login' | 'unavailable') => {
   note.textContent = state === 'login' ? t('需要先登录腾讯元宝，登录后这里会自动继续。') : state === 'loading' ? t('正在读取。已登录元宝的话会自动完成。') : t('没能读取这条视频：链接可能已失效，或你的账号没有观看权限。');
   open.hidden = state !== 'login'; retry.hidden = state !== 'unavailable';
  };
  const attempt = async () => {
   if (busy || done) return;
   busy = true;
   try {
    const result = await message('read');
    if (done) return;
    if (result.state === 'ready' && result.info && result.sourceUrl) { done = true; stop(); row.remove(); resolve({ info: result.info, sourceUrl: result.sourceUrl }); return; }
    failures = result.state === 'unavailable' ? failures + 1 : 0;
    show(result.state === 'login' ? 'login' : failures >= 3 ? 'unavailable' : 'loading');
   } catch { failures++; show(failures >= 3 ? 'unavailable' : 'loading'); }
   finally { busy = false; }
  };
  const schedule = () => {
   stop(); if (done || failures >= 3) return;
   if (Date.now() >= deadline) { show('unavailable'); return; }
   timer = win.setTimeout(() => { void attempt().then(schedule); }, 3000);
  };
  const start = () => {
   if (busy || done) return;
   stop(); busy = true; failures = 0; show('loading');
   void message('open').then(result => {
    if (done) return;
    if (result.state === 'opened') { deadline = Date.now() + 180000; schedule(); } else show('unavailable');
   }).catch(() => { show('unavailable'); }).finally(() => { busy = false; });
  };
  open.addEventListener('click', () => { void message('show').catch(() => {}); });
  retry.addEventListener('click', start);
  if (autoOpen) start(); else retry.hidden = false;
 });
}

// The study reader asks for the media of a playback page the viewer has open. Only the page's own answer counts, and only for this exact video and a verified Tencent media address.
export async function getChannelsPlaybackMedia(url: string, sourceTabId: number | undefined,
 api: { get(id: number): Promise<{ url?: string }>; query(options: object): Promise<Array<{ id?: number; url?: string }>>; sendMessage(id: number, message: object): Promise<unknown> }): Promise<WebInfo | undefined> {
 const canonical = channelsPlaybackPage(url); if (!canonical) return;
 try {
  let tab: { id?: number; url?: string } | undefined;
  if (Number.isInteger(sourceTabId) && sourceTabId! >= 0) { try { tab = { ...(await api.get(sourceTabId!)), id: sourceTabId }; } catch { /* the original tab was closed */ } }
  if (!tab?.url || channelsPlaybackPage(tab.url) !== canonical) tab = ((await api.query({ url: 'https://channels.weixin.qq.com/*' })) || []).find(candidate => channelsPlaybackPage(candidate.url || '') === canonical);
  if (tab?.id === undefined || channelsPlaybackPage(tab.url || '') !== canonical) return;
  const answer = await api.sendMessage(tab.id, { action: 'qiaomuWebMediaSource' }) as { url?: string; info?: WebInfo } | undefined;
  const info = answer?.info;
  if (answer?.url !== canonical || !info || !isChannelsMedia(canonical, info.mediaUrl)) return;
  return { ok: true, title: String(info.title || '').slice(0, 600), author: String(info.author || '').slice(0, 200), seconds: Number.isFinite(info.seconds) ? info.seconds : null, thumbnail: null,
   site: 'WeChat Channels', mediaUrl: info.mediaUrl, video: true, description: String(info.description || '').slice(0, 6000) };
 } catch { /* the page is gone or not ready */ }
}
