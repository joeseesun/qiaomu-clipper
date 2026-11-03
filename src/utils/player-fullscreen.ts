// Fullscreen must start on the caption container before the embed consumes user activation.
// Waiting for the iframe's fullscreenchange is too late: its siblings are outside the top layer.
const STATE = 'fullscreen-state';
const READY = 'fullscreen-ready';
const TOGGLE = 'fullscreen-toggle';
const FULLSCREEN_BUTTON = '.ytp-fullscreen-button,.ytwPlayerBottomControlsFullscreenButtonWrapper button.fullscreen-icon,.ytwPlayerFullscreenTopControlsFullscreenCloseButtonWrapper button';
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=menu],[role=dialog]');
const fullscreenKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && !editable(event.target);

export function mountPlayerFullscreen(container: HTMLElement, frame: HTMLIFrameElement, failed: () => void): () => void {
 const doc = container.ownerDocument, win = doc.defaultView!;
 const url = new URL(frame.src);
 if (url.origin !== 'https://www.youtube.com' || !url.pathname.startsWith('/embed/')) return () => {};
 let disposed = false, pending = false;
 const send = (enabled = true) => {
  if (!frame.isConnected) return;
  frame.contentWindow?.postMessage({qiaomuPlayer: STATE, enabled, active: doc.fullscreenElement === container}, url.origin);
 };
 const toggle = async () => {
  if (disposed || pending || !container.isConnected) return;
  pending = true;
  try {
   if (doc.fullscreenElement === container) await doc.exitFullscreen();
   else await container.requestFullscreen();
  } catch { if (!disposed) failed(); }
  finally { pending = false; if (!disposed) send(); }
 };
 const message = (event: MessageEvent) => {
  if (event.source !== frame.contentWindow || event.origin !== url.origin) return;
  if (event.data?.qiaomuPlayer === READY) send();
  else if (event.data?.qiaomuPlayer === TOGGLE) void toggle();
 };
 const change = () => send();
 const key = (event: KeyboardEvent) => {
  if (event.defaultPrevented || !fullscreenKey(event)) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat) void toggle();
 };
 win.addEventListener('message', message);
 doc.addEventListener('fullscreenchange', change);
 container.addEventListener('keydown', key);
 frame.addEventListener('load', change);
 send();
 return () => {
  disposed = true; send(false);
  win.removeEventListener?.('message', message);
  doc.removeEventListener('fullscreenchange', change);
  container.removeEventListener('keydown', key);
  frame.removeEventListener('load', change);
 };
}

// Called only by our YouTube embed content script, after checking the extension ancestor.
export function mountEmbeddedFullscreen(origin: string): () => void {
 let enabled = false;
 const message = (event: MessageEvent) => {
  if (event.source !== window.parent || event.origin !== origin || event.data?.qiaomuPlayer !== STATE || typeof event.data.enabled !== 'boolean') return;
  enabled = event.data.enabled;
 };
 const request = (event: Event) => {
  event.preventDefault(); event.stopImmediatePropagation();
  window.parent.postMessage({qiaomuPlayer: TOGGLE}, origin);
 };
 const click = (event: MouseEvent) => {
  if (enabled && event.button === 0 && event.target instanceof Element && event.target.closest(FULLSCREEN_BUTTON)) request(event);
 };
 const doubleClick = (event: MouseEvent) => {
  if (!enabled || event.button !== 0 || !(event.target instanceof Element) || editable(event.target)) return;
  if (event.target.closest('.html5-video-player,ytm-custom-control') && !event.target.closest('button,a,.ytp-chrome-bottom,.ytp-popup,.ytp-settings-menu,player-bottom-controls,player-fullscreen-top-controls')) request(event);
 };
 const key = (event: KeyboardEvent) => {
  if (!enabled || !fullscreenKey(event) || !document.querySelector('.html5-video-player video')) return;
  // Suppress both phases; YouTube versions may listen on keydown or keyup.
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.type === 'keydown' && !event.repeat) window.parent.postMessage({qiaomuPlayer: TOGGLE}, origin);
 };
 window.addEventListener('message', message);
 window.addEventListener('click', click, true);
 window.addEventListener('dblclick', doubleClick, true);
 window.addEventListener('keydown', key, true);
 window.addEventListener('keyup', key, true);
 window.parent.postMessage({qiaomuPlayer: READY}, origin);
 return () => {
  enabled = false;
  window.removeEventListener('message', message);
  window.removeEventListener('click', click, true);
  window.removeEventListener('dblclick', doubleClick, true);
  window.removeEventListener('keydown', key, true);
  window.removeEventListener('keyup', key, true);
 };
}
