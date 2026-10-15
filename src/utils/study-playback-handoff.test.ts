// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ execute: vi.fn(), create: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { scripting: { executeScript: state.execute }, tabs: { create: state.create }, runtime: { getURL: (path: string) => 'https://extension.example/' + path } } }));
import { sourceStudyPlayback, openStudyWithPlayback, takeStudyPlayback, startStudyMedia, startStudyPlayback } from './study-playback-handoff';
const defaults = { time: 28.5, rate: 1.5, volume: .4, muted: true };
beforeEach(() => {
 vi.clearAllMocks(); document.body.innerHTML = ''; history.replaceState({}, '', '/');
 state.create.mockResolvedValue({ id: 9 }); state.execute.mockResolvedValue([]);
 vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); });
function source() {
 document.body.innerHTML = '<video id="off"></video><video id="main"></video><video id="small"></video>';
 const main = document.querySelector<HTMLVideoElement>('#main')!; main.src = 'https://example.com/lesson.mp4';
 Object.defineProperty(main, 'paused', { value: false, configurable: true }); main.currentTime = defaults.time;
 main.playbackRate = defaults.rate; main.volume = defaults.volume; main.muted = defaults.muted;
 vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400));
 vi.spyOn(document.querySelector<HTMLVideoElement>('#small')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 50));
 return main;
}
it('runs serialized without module dependencies and pauses only the current visible source', () => {
 const main = source();
 const injected = new Function('return (' + sourceStudyPlayback.toString() + ')')() as typeof sourceStudyPlayback;
 expect(injected('snapshot', location.href, 'one')).toMatchObject(defaults);
 expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
 expect(injected('pause', location.href, 'one')).toMatchObject(defaults);
 expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
 expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.instances[0]).toBe(main);
});
it('never pauses a source that navigated or whose media changed during handoff', () => {
 const main = source(); sourceStudyPlayback('snapshot', location.href, 'one');
 main.src = 'https://example.com/next.mp4'; expect(sourceStudyPlayback('pause', location.href, 'one')).toBeNull();
 expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
 expect(sourceStudyPlayback('snapshot', 'https://another.example/', 'two')).toBeNull();
});
it('restores only the previously playing source on failed opening', () => {
 const main = source(); sourceStudyPlayback('snapshot', location.href, 'one'); sourceStudyPlayback('pause', location.href, 'one');
 Object.defineProperty(main, 'paused', { value: true }); sourceStudyPlayback('restore', location.href, 'one');
 expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
 sourceStudyPlayback('snapshot', location.href, 'two'); sourceStudyPlayback('pause', location.href, 'two'); sourceStudyPlayback('restore', location.href, 'two');
 expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
});
function mockSource(playing = true) {
 state.execute.mockImplementation(async ({ args, target }: any) => {
  if (args[0] === 'snapshot') return [{ frameId: 0, result: { ...defaults, playing, score: 100 } }, { frameId: 4, result: { ...defaults, playing, score: 1000 } }];
  if (args[0] === 'pause') return [{ frameId: target.frameIds[0], result: { ...defaults, playing, score: 0 } }];
  return [];
 });
}
it.each([true, false])('pauses before opening and requests autoplay even when source playing=%s', async playing => {
 mockSource(playing); await openStudyWithPlayback(7, 'reader.html?study=web&url=lesson', location.href);
 const calls = state.execute.mock.calls.map(([options]) => options);
 expect(calls.find(call => call.args[0] === 'pause').target).toEqual({ tabId: 7, frameIds: [4] });
 expect(state.execute.mock.invocationCallOrder[1]).toBeLessThan(state.create.mock.invocationCallOrder[0]);
 const route = new URL(state.create.mock.calls[0][0].url);
 expect(route.searchParams.get('studyPlay')).toBe('1'); expect(route.searchParams.get('studyTime')).toBe('28.5');
 expect(route.searchParams.get('studyRate')).toBe('1.5'); expect(route.searchParams.get('studyMuted')).toBe('1');
 expect(state.create.mock.calls[0][0].openerTabId).toBe(7);
});
it('rolls back a failed tab creation and releases references in every probed frame', async () => {
 mockSource(); state.create.mockRejectedValue(new Error('tab failed'));
 await expect(openStudyWithPlayback(7, 'reader.html?study=web', location.href)).rejects.toThrow('tab failed');
 expect(state.execute.mock.calls.map(([options]) => options.args[0])).toEqual(['snapshot', 'pause', 'restore', 'release', 'release']);
});
it('opens with autoplay when the original player is inaccessible and merges simultaneous entry requests', async () => {
 state.execute.mockRejectedValue(new Error('permission'));
 await Promise.all([openStudyWithPlayback(7, 'reader.html?study=youtube', location.href), openStudyWithPlayback(7, 'reader.html?study=youtube', location.href)]);
 expect(state.create).toHaveBeenCalledOnce(); expect(state.create.mock.calls[0][0].url).toContain('studyPlay=1');
});
it('consumes autoplay and initial position once while retaining source and editing parameters', () => {
 history.replaceState({}, '', '/reader.html?study=web&url=lesson&resume=draft&studyPlay=1&studyTime=28.5&studyRate=1.5&studyVolume=.4&studyMuted=1');
 expect(takeStudyPlayback(window)).toEqual(defaults); expect(location.search).toBe('?study=web&url=lesson&resume=draft');
 expect(takeStudyPlayback(window)).toBeUndefined();
});
it('waits for native media metadata, seeks, preserves settings and plays once', () => {
 document.body.innerHTML = '<video></video>'; const player = document.querySelector('video')!;
 startStudyMedia(player, defaults); expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
 player.dispatchEvent(new Event('loadedmetadata')); expect(player.currentTime).toBe(28.5); expect(player.playbackRate).toBe(1.5);
 expect(player.volume).toBe(.4); expect(player.muted).toBe(true); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
 player.dispatchEvent(new Event('loadedmetadata')); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
});
it('keeps playback controls usable when autoplay is denied', async () => {
 document.body.innerHTML = '<video controls></video>'; const player = document.querySelector('video')!;
 Object.defineProperty(player, 'readyState', { value: 1 }); vi.mocked(player.play).mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
 startStudyMedia(player, defaults); await Promise.resolve(); expect(player.controls).toBe(true); expect(player.currentTime).toBe(28.5);
});
it.each(['https://www.youtube.com/embed/abcdefghijk?enablejsapi=1', 'https://player.bilibili.com/player.html?bvid=BV1XJCzYyEcp&autoplay=0'])('hands off an embed once after metadata, validating frame and origin: %s', src => {
 document.body.innerHTML = `<article><iframe src="${src}"></iframe></article>`;
 const article = document.querySelector('article')!, frame = article.querySelector('iframe')!;
 startStudyPlayback(article, defaults); const route = new URL(frame.src);
 expect(route.searchParams.get('autoplay')).toBe('1'); expect(route.searchParams.get(route.hostname.includes('bilibili') ? 't' : 'start')).toBe('28');
 const send = vi.spyOn(frame.contentWindow!, 'postMessage');
 const notify = (ready: boolean, origin = route.origin, source: Window | null = frame.contentWindow) => window.dispatchEvent(new MessageEvent('message', { origin, source, data: { qiaomuPlayer: 'time', ready } }));
 notify(false); notify(true, 'https://evil.example'); notify(true, route.origin, window); expect(send).not.toHaveBeenCalled();
 notify(true); expect(send).toHaveBeenCalledExactlyOnceWith({ qiaomuPlayer: 'handoff', ...defaults }, route.origin);
 notify(true); expect(send).toHaveBeenCalledOnce();
});
