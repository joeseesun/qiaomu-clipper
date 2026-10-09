import { preserveRemotePreviewMedia, mountRemotePreviewMedia } from './remote-preview-media';
import type { ClipPreview } from './clip-preview';
import { updateClipPreview } from './clip-preview';
import { putHandedFile, takeHandedFile, releaseHandedFile } from './file-handoff';
import { isVideoFile, mountMediaStudyPlayer } from './media-study-player';
import { t } from './ui-text';

// A blob URL belongs to one document. Keep a short-lived File handoff for mode navigation,
// and put only its random token and playback state in the text draft (never the URL or bytes).
export interface LocalPreviewMedia {
 token: string; name: string; size: number; modified: number;
 time: number; rate: number; volume: number; muted: boolean;
}
const active = new WeakMap<ClipPreview, { file: File; player: HTMLVideoElement; token?: string }>();
export function bindLocalPreviewMedia(draft: ClipPreview, file: File, player: HTMLVideoElement, token?: string) {
 active.set(draft, { file, player, token });
}
export async function preserveLocalPreviewMedia(draft: ClipPreview): Promise<void> {
 const media = active.get(draft); if (!media) { await preserveRemotePreviewMedia(draft); return; }
 const previous = draft.localMedia;
 let token = media.token;
 if (!token || !await takeHandedFile(token)) token = await putHandedFile(media.file);
 if (!token) throw new Error(t('无法保留本地视频，请留在当前页面重试切换。字幕不会丢失。'));
 const player = media.player;
 draft.localMedia = { token, name: media.file.name, size: media.file.size, modified: media.file.lastModified,
  time: player.currentTime, rate: player.playbackRate, volume: player.volume, muted: player.muted };
 try { await updateClipPreview(draft); }
 catch (error) { draft.localMedia = previous; if (token !== media.token) await releaseHandedFile(token); throw error; }
 media.token = token;
 if (previous?.token && previous.token !== token) await releaseHandedFile(previous.token);
}

// No helper upload/ASR call is needed to play an already recognised local file.
export async function mountLocalPreviewMedia(draft: ClipPreview, parent: HTMLElement, before: HTMLElement, ready?: () => Promise<void>): Promise<void> {
 const info = draft.localMedia; if (!info) { await mountRemotePreviewMedia(draft, parent, before, ready); return; }
 const mount = async (file: File, token?: string) => {
  const src = URL.createObjectURL(file), player = mountMediaStudyPlayer(parent, before, src, isVideoFile(file));
  player.controls = true; // Native controls also keep audio usable in the editor.
  player.parentElement!.classList.add('local-preview-media');
  player.playbackRate = Number.isFinite(info.rate) && info.rate > 0 ? info.rate : 1;
  player.volume = Number.isFinite(info.volume) ? Math.min(1, Math.max(0, info.volume)) : 1;
  player.muted = Boolean(info.muted);
  player.addEventListener('loadedmetadata', () => { if (Number.isFinite(info.time)) player.currentTime = Math.max(0, Math.min(info.time, Number.isFinite(player.duration) ? player.duration : info.time)); }, { once: true });
  bindLocalPreviewMedia(draft, file, player, token);
  parent.ownerDocument.defaultView?.addEventListener('pagehide', () => { player.pause(); URL.revokeObjectURL(src); }, { once: true });
  await ready?.();
 };
 const file = await takeHandedFile(info.token);
 if (file) { await mount(file, info.token); return; }
 const recovery = parent.ownerDocument.createElement('label'); recovery.className = 'local-preview-reselect';
 recovery.textContent = t('本地视频的临时播放记录已过期，请重新选择同一文件。字幕和编辑内容保留，不会重新识别。');
 const input = parent.ownerDocument.createElement('input'); input.type = 'file'; input.accept = 'audio/*,video/*'; recovery.append(input); before.before(recovery);
 input.addEventListener('change', () => { void (async () => {
  const chosen = input.files?.[0]; if (!chosen) return;
  if (chosen.name !== info.name || chosen.size !== info.size || chosen.lastModified !== info.modified) { recovery.firstChild!.textContent = t('请选择原来的同一文件。'); input.value = ''; return; }
  await mount(chosen); recovery.remove();
 })(); });
}

// Mark the edited timestamp paragraphs rather than restoring the pre-edit transcript.
export function prepareLocalPreviewTranscript(article: HTMLElement): HTMLElement | undefined {
 const rows = Array.from(article.querySelectorAll<HTMLParagraphElement>('p')).filter(p => /^\[?\d+(?::\d{2}){1,2}\]?$/.test(p.querySelector('strong')?.textContent?.trim() || ''));
 if (!rows.length) return undefined;
 const heading = rows[0].previousElementSibling;
 const transcript = article.ownerDocument.createElement('div'); transcript.className = 'transcript youtube'; rows[0].before(transcript);
 if (heading?.tagName === 'H2') transcript.append(heading);
 for (const row of rows) {
  row.classList.add('transcript-segment'); const strong = row.querySelector('strong')!;
  const parts = strong.textContent!.replace(/[\[\]]/g, '').split(':').map(Number);
  strong.classList.add('timestamp'); strong.dataset.timestamp = String(parts.reduce((seconds, part) => seconds * 60 + part, 0)); transcript.append(row);
 }
 return transcript;
}
