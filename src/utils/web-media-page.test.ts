// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: {} }));
import { activeWebMedia, currentWebMediaAddress, webMediaAddress } from './web-media-page';

it('recognizes media items across supported sites without sending feeds or lookalike hosts to recognition', () => {
	const items = [
		'https://www.tiktok.com/@maker/video/123456789', 'https://www.douyin.com/video/123456789',
		'https://vimeo.com/1234567', 'https://www.instagram.com/reel/abc/', 'https://www.facebook.com/watch/?v=123',
		'https://www.reddit.com/r/test/comments/abc/title/', 'https://www.twitch.tv/videos/123',
		'https://www.dailymotion.com/video/abc', 'https://soundcloud.com/maker/track',
		'https://maker.bandcamp.com/track/title', 'https://www.nicovideo.jp/watch/sm123',
		'https://weibo.com/123456/abcdef', 'https://www.ximalaya.com/sound/1234',
		'https://music.163.com/#/song?id=123', 'https://www.ted.com/talks/title',
		'https://podcasts.apple.com/us/podcast/name/id123?i=456', 'https://clips.twitch.tv/Title',
	];
	for (const item of items) expect(webMediaAddress(item), item).toBe(item);
	expect(webMediaAddress('https://www.douyin.com/?modal_id=123456789')).toBe('https://www.douyin.com/video/123456789');
	for (const bad of ['https://www.tiktok.com/foryou', 'https://www.tiktok.com/@maker', 'https://www.douyin.com/', 'https://www.facebook.com/watch/', 'https://soundcloud.com/stream', 'https://soundcloud.com/maker', 'https://vimeo.com.evil.test/123', 'https://youtube.com/watch?v=abcdefghi12', 'http://vimeo.com/123', 'https://example.com/video/1']) expect(webMediaAddress(bad), bad).toBeNull();
});

it('chooses the playing visible video over preloads and uses its own feed card address', () => {
	document.body.innerHTML = '<article><video id="off"></video><a href="https://www.tiktok.com/@a/video/111">A</a></article><article><video id="on"></video><a href="https://www.tiktok.com/@a/video/222">B</a></article>';
	const off = document.querySelector<HTMLVideoElement>('#off')!, on = document.querySelector<HTMLVideoElement>('#on')!;
	vi.spyOn(off,'getBoundingClientRect').mockReturnValue({left:0,top:2000,right:400,bottom:2300,width:400,height:300} as DOMRect);
	vi.spyOn(on,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:400,bottom:300,width:400,height:300} as DOMRect);
	Object.defineProperty(on,'paused',{value:false});
	expect(activeWebMedia(document)).toBe(on);
	expect(currentWebMediaAddress(document,on,'https://www.tiktok.com/foryou')).toBe('https://www.tiktok.com/@a/video/222');
	on.closest('article')!.querySelector('a')!.href='https://evil.test/@a/video/222';
	expect(currentWebMediaAddress(document,on,'https://www.tiktok.com/foryou')).toBeNull();
	expect(currentWebMediaAddress(document,on,'https://www.douyin.com/?modal_id=333')).toBe('https://www.douyin.com/video/333');
});

it('finds a visible cross-origin embed without accessing its document', () => {
	document.body.innerHTML='<iframe src="https://player.vimeo.com/video/123"></iframe>';
	const frame=document.querySelector('iframe')!;
	vi.spyOn(frame,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:400,bottom:300,width:400,height:300} as DOMRect);
	expect(activeWebMedia(document)).toBe(frame);
	expect(currentWebMediaAddress(document,frame,'https://vimeo.com/123')).toBe('https://vimeo.com/123');
});

it('identifies TikTok feed items from the live player wrapper and author, without relying on a missing detail link', () => {
 document.body.innerHTML='<article><div id="xgwrapper-0-7679171926396472578"><video></video></div><a href="https://www.tiktok.com/@maker">Maker</a></article>';
 expect(currentWebMediaAddress(document,document.querySelector('video')!,'https://www.tiktok.com/')).toBe('https://www.tiktok.com/@maker/video/7679171926396472578');
});
