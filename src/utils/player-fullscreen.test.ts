// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountEmbeddedFullscreen, mountPlayerFullscreen } from './player-fullscreen';

let stop = () => {};
const extension = 'chrome-extension://mock-id', youtube = 'https://www.youtube.com';
afterEach(() => { stop(); stop = () => {}; vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as any).fullscreenElement; document.body.innerHTML = ''; });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function parentSetup() {
 document.body.innerHTML = '<div class="player-container" tabindex="0"><iframe src="https://www.youtube.com/embed/test"></iframe><div class="q-caption-overlay">中文字幕</div><input></div>';
 const container = document.querySelector<HTMLElement>('.player-container')!, frame = document.querySelector('iframe')!;
 const request = vi.fn().mockResolvedValue(undefined), exit = vi.fn().mockResolvedValue(undefined), failed = vi.fn();
 container.requestFullscreen = request; document.exitFullscreen = exit;
 const post = vi.spyOn(frame.contentWindow!, 'postMessage');
 stop = mountPlayerFullscreen(container, frame, failed);
 const send = (type: string, origin = youtube, source = frame.contentWindow) => window.dispatchEvent(new MessageEvent('message', {origin, source, data: {qiaomuPlayer: type}}));
 return {container, frame, request, exit, failed, post, send};
}

it('enters the caption container, keeps the caption node, and exits it on the next native toggle', async () => {
 const {container, request, exit, post, send} = parentSetup();
 send('fullscreen-ready');
 expect(post).toHaveBeenLastCalledWith({qiaomuPlayer: 'fullscreen-state', enabled: true, active: false}, youtube);
 send('fullscreen-toggle'); await flush(); expect(request).toHaveBeenCalledOnce();
 expect(container.querySelector('.q-caption-overlay')?.textContent).toBe('中文字幕');
 Object.defineProperty(document, 'fullscreenElement', {configurable: true, value: container});
 document.dispatchEvent(new Event('fullscreenchange'));
 expect(post).toHaveBeenLastCalledWith({qiaomuPlayer: 'fullscreen-state', enabled: true, active: true}, youtube);
 send('fullscreen-toggle'); await flush(); expect(exit).toHaveBeenCalledOnce();
 delete (document as any).fullscreenElement; document.dispatchEvent(new Event('fullscreenchange'));
 expect(post).toHaveBeenLastCalledWith({qiaomuPlayer: 'fullscreen-state', enabled: true, active: false}, youtube);
});

it('rejects other frames/origins and disables interception when captions are unmounted', async () => {
 const {request, post, send} = parentSetup();
 send('fullscreen-toggle', 'https://evil.example'); send('fullscreen-toggle', youtube, window);
 expect(request).not.toHaveBeenCalled(); stop();
 expect(post).toHaveBeenLastCalledWith({qiaomuPlayer: 'fullscreen-state', enabled: false, active: false}, youtube);
 send('fullscreen-toggle'); await flush(); expect(request).not.toHaveBeenCalled();
});

it('coalesces pending transitions and allows a new gesture after a rejected request', async () => {
 const {request, failed, send} = parentSetup(); let reject!: (error: Error) => void;
 request.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
 send('fullscreen-toggle'); send('fullscreen-toggle'); expect(request).toHaveBeenCalledOnce();
 reject(new Error('denied')); await flush(); expect(failed).toHaveBeenCalledOnce();
 send('fullscreen-toggle'); await flush(); expect(request).toHaveBeenCalledTimes(2);
});

it('does not message a removed iframe during reader cleanup', () => {
 const {container, post} = parentSetup(); post.mockClear(); container.remove();
 expect(() => stop()).not.toThrow(); expect(post).not.toHaveBeenCalled();
});

it('supports F after focus returns to the outer player and leaves typing/repeats alone', async () => {
 const {container, request} = parentSetup();
 container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', bubbles: true}));
 container.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', ctrlKey: true, bubbles: true}));
 container.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', repeat: true, bubbles: true}));
 expect(request).not.toHaveBeenCalled();
 container.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', bubbles: true})); await flush();
 expect(request).toHaveBeenCalledOnce();
});

function embedSetup() {
 document.body.innerHTML = '<div class="html5-video-player"><video></video><button class="ytp-fullscreen-button"><svg><path></path></svg></button><button class="other"></button><input><div contenteditable="true"></div><div class="ytp-settings-menu"></div></div>';
 const original = window, parent = {postMessage: vi.fn()}, scope = Object.create(original);
 Object.defineProperties(scope, {parent: {value: parent}, addEventListener: {value: original.addEventListener.bind(original)}, removeEventListener: {value: original.removeEventListener.bind(original)}});
 vi.stubGlobal('window', scope);
 stop = mountEmbeddedFullscreen(extension);
 const send = (enabled = true, origin = extension, source = parent) => original.dispatchEvent(new MessageEvent('message', {origin, source: source as any, data: {qiaomuPlayer: 'fullscreen-state', enabled, active: false}}));
 const button = document.querySelector<HTMLElement>('.ytp-fullscreen-button')!;
 const count = () => parent.postMessage.mock.calls.filter(([data]) => data.qiaomuPlayer === 'fullscreen-toggle').length;
 return {send, button, count};
}

it('takes over only after the owning extension parent acknowledges, and restores native behavior on cleanup', () => {
 const {send, button, count} = embedSetup(), native = vi.fn(); button.addEventListener('click', native);
 button.click(); send(true, 'https://evil.example'); send(true, extension, {} as any); button.click();
 expect(count()).toBe(0); expect(native).toHaveBeenCalledTimes(2);
 send(); button.querySelector('path')!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
 expect(count()).toBe(1); expect(native).toHaveBeenCalledTimes(2);
 send(false); button.click(); expect(native).toHaveBeenCalledTimes(3);
 send(); stop(); button.click(); expect(native).toHaveBeenCalledTimes(4); expect(count()).toBe(1);
});

it('routes a video double click once, without hijacking settings or other controls', () => {
 const {send, count} = embedSetup(); send();
 const native = vi.fn(); document.addEventListener('dblclick', native, {once: true});
 document.querySelector('video')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
 expect(count()).toBe(1); expect(native).not.toHaveBeenCalled();
 for (const selector of ['.other', '.ytp-settings-menu', 'input', '[contenteditable]']) document.querySelector(selector)!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
 expect(count()).toBe(1); expect(native).toHaveBeenCalledOnce();
});

it('supports the new YouTube embed controls mounted beside the underlying player', () => {
 const {send, count} = embedSetup(); send();
 const controls = document.createElement('ytm-custom-control');
 controls.innerHTML = '<div class="ytwPlayerBottomControlsFullscreenButtonWrapper"><button class="fullscreen-icon"><svg></svg></button></div><player-middle-controls></player-middle-controls><player-bottom-controls></player-bottom-controls>';
 document.body.append(controls);
 controls.querySelector('svg')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 controls.querySelector('player-middle-controls')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
 controls.querySelector('player-bottom-controls')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
 expect(count()).toBe(2);
});

it('routes one F key gesture before YouTube consumes activation, ignoring key repeats, modifiers and typing', () => {
 const {send, count} = embedSetup(); send();
 const video = document.querySelector('video')!, native = vi.fn(); video.addEventListener('keydown', native);
 for (const type of ['keydown', 'keyup']) video.dispatchEvent(new KeyboardEvent(type, {key: 'f', bubbles: true, cancelable: true}));
 video.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', repeat: true, bubbles: true}));
 expect(count()).toBe(1); expect(native).not.toHaveBeenCalled();
 for (const extra of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true}, {isComposing: true}]) video.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', bubbles: true, ...extra}));
 for (const selector of ['input', '[contenteditable]']) document.querySelector(selector)!.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', bubbles: true}));
 expect(count()).toBe(1); expect(native).toHaveBeenCalledTimes(5);
});
