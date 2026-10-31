import { expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: vi.fn() } } }));
import { isMediaItemAddress, webMediaAddress } from './web-media-page';

it('treats a Channels share and its playback page as study items, and nothing else on that host', () => {
	expect(webMediaAddress('https://weixin.qq.com/sph/Fixture123')).toBe('https://weixin.qq.com/sph/Fixture123');
	expect(webMediaAddress('https://channels.weixin.qq.com/finder-preview/pages/feed?token=t&eid=e1')).toBe('https://channels.weixin.qq.com/finder-preview/pages/feed?eid=e1');
	expect(isMediaItemAddress('https://weixin.qq.com/sph/Fixture123')).toBe(true);
	for (const other of ['https://weixin.qq.com/', 'https://weixin.qq.com/cgi-bin/x', 'https://channels.weixin.qq.com/platform', 'https://mp.weixin.qq.com/s/x']) expect(webMediaAddress(other)).toBeNull();
});
