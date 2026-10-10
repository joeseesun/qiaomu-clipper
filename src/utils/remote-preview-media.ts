import browser from './browser-polyfill';
import type { ClipPreview } from './clip-preview';
import { updateClipPreview } from './clip-preview';
import { mountMediaStudyPlayer } from './media-study-player';
import { t } from './ui-text';

export interface RemotePreviewMedia { token: string; time: number; rate: number; volume: number; muted: boolean }
type Source = { src: string; video: boolean; poster?: string; audioUrl?: string; expires: number };
const active = new WeakMap<ClipPreview, Source & { player: HTMLVideoElement }>();
const prefix = 'qiaomuPreviewMedia:';
const safe = (address: unknown): address is string => {
 try { const u = new URL(String(address)); return typeof address === 'string' && address.length <= 8000 && u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443'); } catch { return false; }
};
export function bindRemotePreviewMedia(draft: ClipPreview, player: HTMLVideoElement, src: string, video: boolean, poster?: string, audioUrl?: string) {
 if (!safe(src) || (audioUrl && !safe(audioUrl))) return;
 active.set(draft, { player, src, video, ...(poster && safe(poster) ? { poster } : {}), ...(audioUrl ? { audioUrl } : {}), expires: Date.now() + 2 * 3600000 });
}

// Same-tab mode navigation keeps signed media only in session storage. The durable text draft gets a random token and player state.
export async function preserveRemotePreviewMedia(draft: ClipPreview): Promise<void> {
 const current = active.get(draft); if (!current) return;
 const previous = draft.remoteMedia, token = previous?.token || crypto.randomUUID(), key = prefix + token;
 const win = current.player.ownerDocument.defaultView!;
 let prior: string | null = null, wrote = false;
 try {
  prior = win.sessionStorage.getItem(key);
  const { player, ...source } = current;
  win.sessionStorage.setItem(key, JSON.stringify({ ...source, expires: Date.now() + 2 * 3600000 })); wrote = true;
  draft.remoteMedia = { token, time: player.currentTime, rate: player.playbackRate, volume: player.volume, muted: player.muted };
  await updateClipPreview(draft);
 } catch {
  draft.remoteMedia = previous;
  if (wrote) { try { if (prior === null) win.sessionStorage.removeItem(key); else win.sessionStorage.setItem(key, prior); } catch { /* keep the playable page */ } }
  throw new Error(t('无法保留视频播放状态，请留在当前页面重试切换。字幕不会丢失。'));
 }
}

export async function mountRemotePreviewMedia(draft: ClipPreview, parent: HTMLElement, before: HTMLElement, ready?: () => Promise<void>, beforeRecover?: () => Promise<void>): Promise<void> {
 const info = draft.remoteMedia; if (!info) return;
 const doc = parent.ownerDocument;
 let source: Source | undefined;
 try {
  if (/^[0-9a-f-]{36}$/.test(info.token)) source = JSON.parse(doc.defaultView!.sessionStorage.getItem(prefix + info.token) || 'null') || undefined;
 } catch { /* expired or unavailable session */ }
 let recovery: HTMLElement | undefined;
 const recover = () => {
  if (recovery) return;
  recovery = doc.createElement('div'); recovery.className = 'local-preview-reselect'; recovery.setAttribute('role', 'status');
  const note = doc.createElement('p'); note.textContent = t('视频的临时播放记录已过期，请重新打开原链接。字幕和编辑内容保留。'); recovery.append(note);
  if (safe(draft.clip.url)) {
   const link = doc.createElement('a'); link.textContent = t('重新打开转写学习'); link.href = browser.runtime.getURL('reader.html?study=web&url=' + encodeURIComponent(draft.clip.url) + '&resume=' + encodeURIComponent(draft.local.requestId)); link.target = '_blank'; link.rel = 'noopener noreferrer';
   let opening = false;
   link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (opening) return; opening = true; void (async () => {
    try { await beforeRecover?.(); await updateClipPreview(draft); await browser.tabs.create({ url: link.href }); }
    catch { note.textContent = t('编辑内容保存失败，请留在当前页面重试或先导出文字。'); }
    finally { opening = false; }
   })(); }); recovery.append(link);
  }
  before.before(recovery);
 };
 if (!source || !Number.isFinite(source.expires) || source.expires < Date.now() || !safe(source.src) || (source.audioUrl && !safe(source.audioUrl))) { recover(); return; }
 const player = mountMediaStudyPlayer(parent, before, source.src, source.video === true, source.poster, source.audioUrl);
 player.controls = true; player.parentElement!.classList.add('local-preview-media');
 restoreRemotePreviewPlayback(draft, player);
 player.addEventListener('error', recover, { once: true });
 bindRemotePreviewMedia(draft, player, source.src, source.video, source.poster, source.audioUrl);
 doc.defaultView?.addEventListener('pagehide', () => player.pause(), { once: true });
 await ready?.();
}

export function restoreRemotePreviewPlayback(draft: ClipPreview, player: HTMLVideoElement): void {
 const info = draft.remoteMedia; if (!info) return;
 player.playbackRate = Number.isFinite(info.rate) && info.rate > 0 ? info.rate : 1;
 player.volume = Number.isFinite(info.volume) ? Math.min(1, Math.max(0, info.volume)) : 1; player.muted = Boolean(info.muted);
 const seek = () => { if (Number.isFinite(info.time)) player.currentTime = Math.max(0, Math.min(info.time, Number.isFinite(player.duration) ? player.duration : info.time)); };
 if (player.readyState >= 1) seek(); else player.addEventListener('loadedmetadata', seek, { once: true });
}
