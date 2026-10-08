// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BRIDGE_CHANNEL } from './utils/youtube-player-bridge-protocol';

// A browser sends a page's own messages with the window as their source and the page's origin; jsdom does not, so say so.
window.postMessage = ((data: unknown) => { setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: window })), 0); }) as typeof window.postMessage;

const ask = (message: object) => new Promise<any>(resolve => {
	const id = Math.random().toString(36).slice(2);
	const on = (event: MessageEvent) => { if (event.data?.channel === BRIDGE_CHANNEL && event.data.dir === 'res' && event.data.id === id) { window.removeEventListener('message', on); resolve(event.data.data); } };
	window.addEventListener('message', on);
	window.postMessage({ channel: BRIDGE_CHANNEL, dir: 'req', id, ...message }, location.origin);
});

describe('the page-world bridge', () => {
	it('tells what the player holds, remembers caption requests the page makes, and switches the captions on and off', async () => {
		document.body.innerHTML = '<div id="movie_player"><button class="ytp-subtitles-button" aria-pressed="false"></button></div>';
		const player = document.querySelector<HTMLElement & Record<string, unknown>>('#movie_player')!;
		const button = document.querySelector<HTMLElement>('.ytp-subtitles-button')!;
		button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')));
		player.getPlayerResponse = () => ({ videoDetails: { videoId: 'abc' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', languageCode: 'en', vssId: '.en', name: { simpleText: 'English' } }, { nope: true }] } } });
		player.getAudioTrack = () => ({ captionTracks: [{ url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=P', languageCode: 'en', vssId: '.en' }] });
		player.getPlayerState = () => 1;
		player.getWebPlayerContextConfig = () => ({ innertubeContextClientVersion: '2.2026' });
		await import('./youtube-player-bridge');

		const first = await ask({ type: 'snapshot' });
		expect(first).toMatchObject({ videoId: 'abc', state: 1, clientVersion: '2.2026', requestUrl: null, captionsOn: false });
		expect(first.tracks).toEqual([{ url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', languageCode: 'en', vssId: '.en', name: 'English' }]);
		expect(first.audioTracks[0].url).toContain('pot=P');

		const xhr = new XMLHttpRequest(); xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=SEEN&potc=1');
		expect((await ask({ type: 'snapshot' })).requestUrl).toContain('pot=SEEN');

		expect(await ask({ type: 'captions', on: true })).toEqual({ changed: true });
		expect((await ask({ type: 'snapshot' })).captionsOn).toBe(true);
		expect(await ask({ type: 'captions', on: true })).toEqual({ changed: false });
		expect(await ask({ type: 'captions', on: false })).toEqual({ changed: true });
	});
});
