import browser from './browser-polyfill';
import { PLAYER_SELECTOR } from './video-source';

export interface StudyPlayback { time: number; rate: number; volume: number; muted: boolean }
interface SourcePlayback extends StudyPlayback { playing: boolean; score: number }

// Serialized into the source page: keep every dependency inside the function.
export function sourceStudyPlayback(action: 'snapshot' | 'pause' | 'restore' | 'release', expectedUrl: string, token: string): SourcePlayback | null {
 const win = window as Window & { qiaomuStudyPlayback?: { token: string; url: string; src: string; player: HTMLMediaElement; playing: boolean } };
 if (window.top === window && location.href !== expectedUrl) return null;
 if (action === 'snapshot') {
  const candidates = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio')).filter(player => {
   if (player.closest('.qiaomu-web-bar, .qiaomu-x, [class*="liveCard"]')) return false;
   return !(typeof MediaStream !== 'undefined' && player.srcObject instanceof MediaStream);
  }).map(player => {
   const r = player.getBoundingClientRect(), css = getComputedStyle(player);
   const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
   const visible = area > 0 && css.display !== 'none' && css.visibility !== 'hidden';
   const usable = visible || (player.tagName === 'AUDIO' && !player.paused);
   return { player, score: usable ? area + (!player.paused && !player.ended ? 1e9 : 0) : -1 };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score);
  const found = candidates[0]; if (!found) return null;
  win.qiaomuStudyPlayback = { token, url: location.href, src: found.player.currentSrc || found.player.src, player: found.player, playing: !found.player.paused && !found.player.ended };
  const p = found.player;
  return { time: Number.isFinite(p.currentTime) ? p.currentTime : 0, rate: p.playbackRate, volume: p.volume, muted: p.muted, playing: !p.paused && !p.ended, score: found.score };
 }
 const saved = win.qiaomuStudyPlayback;
 if (!saved || saved.token !== token) return null;
 if (action === 'release') { delete win.qiaomuStudyPlayback; return null; }
 const p = saved.player;
 if (saved.url !== location.href || !p.isConnected || saved.src !== (p.currentSrc || p.src)) { delete win.qiaomuStudyPlayback; return null; }
 if (action === 'restore') {
  delete win.qiaomuStudyPlayback;
  if (saved.playing && p.paused) void p.play().catch(() => {});
  return null;
 }
 saved.playing = !p.paused && !p.ended;
 const time = p.closest('.ad-showing') ? 0 : Number.isFinite(p.currentTime) ? p.currentTime : 0;
 const state = { time, rate: p.playbackRate, volume: p.volume, muted: p.muted, playing: saved.playing, score: 0 };
 p.pause(); return state;
}

const opening = new Map<number, Promise<void>>();
// Buttons and triple-A converge here. Pause only the selected source player; a failed tab open restores it.
export function openStudyWithPlayback(tabId: number, path: string, sourceUrl: string): Promise<void> {
 const pending = opening.get(tabId); if (pending) return pending;
 const run = async () => {
  const token = crypto.randomUUID();
  let frames: Array<{ frameId: number; result?: SourcePlayback | null }> = [];
  try { frames = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: sourceStudyPlayback, args: ['snapshot', sourceUrl, token] }) as typeof frames; } catch {
   try { frames = await browser.scripting.executeScript({ target: { tabId }, func: sourceStudyPlayback, args: ['snapshot', sourceUrl, token] }) as typeof frames; } catch { /* inaccessible source: the reader can still open */ }
  }
  const selected = frames.filter(frame => frame.result).sort((a, b) => b.result!.score - a.result!.score)[0];
  let playback: SourcePlayback | null | undefined;
  const control = (action: 'pause' | 'restore' | 'release', frameId: number) => browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: sourceStudyPlayback, args: [action, sourceUrl, token] });
  try {
   if (selected) playback = (await control('pause', selected.frameId).catch(() => []))[0]?.result as SourcePlayback | null | undefined;
   const route = new URL(browser.runtime.getURL(path));
   route.searchParams.set('studyPlay', '1');
   if (playback) {
    route.searchParams.set('studyTime', String(playback.time)); route.searchParams.set('studyRate', String(playback.rate));
    route.searchParams.set('studyVolume', String(playback.volume)); route.searchParams.set('studyMuted', playback.muted ? '1' : '0');
   }
   await browser.tabs.create({ url: route.href, openerTabId: tabId });
  } catch (error) {
   if (selected && playback) await control('restore', selected.frameId).catch(() => {});
   throw error;
  } finally {
   await Promise.all(frames.map(frame => control('release', frame.frameId).catch(() => {})));
  }
 };
 const job = run().finally(() => opening.delete(tabId)); opening.set(tabId, job); return job;
}

// Consume the entry intent so refresh/edit/read transitions do not replay an old position.
export function takeStudyPlayback(win: Window): StudyPlayback | undefined {
 const route = new URL(win.location.href); if (route.searchParams.get('studyPlay') !== '1') return;
 const number = (name: string, fallback: number) => { const value = route.searchParams.get(name); return value !== null && Number.isFinite(Number(value)) ? Number(value) : fallback; };
 const playback = { time: Math.max(0, number('studyTime', 0)), rate: Math.min(16, Math.max(.25, number('studyRate', 1))), volume: Math.min(1, Math.max(0, number('studyVolume', 1))), muted: route.searchParams.get('studyMuted') === '1' };
 for (const name of ['studyPlay', 'studyTime', 'studyRate', 'studyVolume', 'studyMuted']) route.searchParams.delete(name);
 win.history.replaceState(win.history.state, '', route.href); return playback;
}

export function startStudyMedia(player: HTMLMediaElement, playback: StudyPlayback): void {
 const start = () => {
  if (!player.isConnected) return;
  player.currentTime = Math.min(playback.time, Number.isFinite(player.duration) ? Math.max(0, player.duration - .01) : playback.time);
  player.playbackRate = playback.rate; player.volume = playback.volume; player.muted = playback.muted;
  // Native controls stay available if the browser rejects autoplay.
  void player.play().catch(() => {});
 };
 if (player.readyState >= 1) start(); else player.addEventListener('loadedmetadata', start, { once: true });
}

export function startStudyPlayback(article: HTMLElement, playback?: StudyPlayback): void {
 if (!playback) return;
 const native = article.querySelector<HTMLMediaElement>('video.reader-video-player');
 if (native) { startStudyMedia(native, playback); return; }
 const frame = article.querySelector<HTMLIFrameElement>(PLAYER_SELECTOR); if (!frame) return;
 const win = article.ownerDocument.defaultView!, source = new URL(frame.src);
 const origin = source.origin;
 const clear = () => { win.removeEventListener('message', ready); win.removeEventListener('pagehide', clear); };
 const ready = (event: MessageEvent) => {
  if (!frame.isConnected) { clear(); return; }
  if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.qiaomuPlayer !== 'time' || event.data.ready !== true) return;
  clear(); frame.contentWindow?.postMessage({ qiaomuPlayer: 'handoff', ...playback }, origin);
 };
 win.addEventListener('message', ready); win.addEventListener('pagehide', clear, { once: true });
 source.searchParams.set(source.hostname === 'player.bilibili.com' ? 't' : 'start', String(Math.floor(playback.time)));
 source.searchParams.set('autoplay', '1'); frame.src = source.href;
}
