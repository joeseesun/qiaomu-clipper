import { t } from './ui-text';
// Chrome's Document Picture-in-Picture can host the whole embed in an always-on-top window.
// YouTube's cross-origin iframe has no <video> we can hand to the classic PiP API, so we move the
// iframe itself; the browser reloads a moved iframe, so we resume from the last reported time.
interface PipWindow extends Window { document: Document }
type PipHost = Window & { documentPictureInPicture?: { requestWindow(options?: { width?: number; height?: number }): Promise<PipWindow>; window?: PipWindow | null } };

export const documentPipSupported = (win: Window): boolean => typeof (win as PipHost).documentPictureInPicture?.requestWindow === 'function';

interface Playback { time: number; playing: boolean }
const playback = new WeakMap<HTMLElement, Playback>();

// The transcript already asks the player for its time; remember the answers.
export function trackPlayback(article: HTMLElement): void {
	if (playback.has(article)) return;
	const state: Playback = { time: 0, playing: false }; playback.set(article, state);
	const win = article.ownerDocument.defaultView; if (!win) return;
	win.addEventListener('message', event => {
		const frame = article.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed/"]');
		if (!frame || event.source !== frame.contentWindow) return;
		try {
			const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
			if (typeof data?.info?.currentTime === 'number') state.time = data.info.currentTime;
			if (typeof data?.info?.playerState === 'number') state.playing = data.info.playerState === 1;
		} catch { /* not a YouTube message */ }
	});
}

const withStart = (frame: HTMLIFrameElement, state: Playback): string => {
	const url = new URL(frame.src);
	url.searchParams.set('start', String(Math.max(0, Math.floor(state.time))));
	if (state.playing) url.searchParams.set('autoplay', '1'); else url.searchParams.delete('autoplay');
	return url.toString();
};

let active: { window: PipWindow; close: () => void } | undefined;

export async function openDocumentPip(article: HTMLElement, frame: HTMLIFrameElement): Promise<void> {
	if (active) { active.close(); return; }
	const doc = article.ownerDocument, win = doc.defaultView as PipHost | null;
	if (!win || !documentPipSupported(win)) return;
	const state = playback.get(article) || { time: 0, playing: false };
	const snapshot = { ...state }, savedStyle = frame.getAttribute('style'), savedSrc = frame.src;
	let pip: PipWindow;
	try { pip = await win.documentPictureInPicture!.requestWindow({ width: 480, height: 270 }); } catch { return; }

	const placeholder = doc.createElement('button'); placeholder.type = 'button'; placeholder.className = 'youtube-pip-placeholder';
	placeholder.textContent = t('视频正在独立窗口播放 · 点击收回'); placeholder.setAttribute('aria-label', t('收回独立窗口中的视频'));
	const style = pip.document.createElement('style');
	style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}';
	pip.document.head.append(style);
	frame.replaceWith(placeholder);
	frame.setAttribute('style', ''); frame.src = withStart(frame, snapshot);
	pip.document.body.append(frame);

	// Time and state updates now arrive in the PiP window; hand them to the page's own listener.
	const relay = (event: MessageEvent) => {
		win.dispatchEvent(new MessageEvent('message', { data: event.data, origin: event.origin, source: event.source }));
	};
	pip.addEventListener('message', relay as EventListener);
	let closed = false;
	const restore = () => {
		if (closed) return; closed = true; active = undefined;
		pip.removeEventListener('message', relay as EventListener);
		const latest = playback.get(article) || snapshot;
		if (placeholder.isConnected) {
			if (savedStyle === null) frame.removeAttribute('style'); else frame.setAttribute('style', savedStyle);
			frame.src = withStart({ src: savedSrc } as HTMLIFrameElement, latest);
			placeholder.replaceWith(frame);
		}
	};
	const close = () => { try { pip.close(); } catch { /* already closed */ } restore(); };
	active = { window: pip, close };
	pip.addEventListener('pagehide', restore);
	placeholder.onclick = close;
	win.addEventListener('pagehide', close, { once: true });
}
