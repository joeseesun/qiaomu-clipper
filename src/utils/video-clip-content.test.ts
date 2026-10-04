// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { tidyBilibiliContent } from './video-clip-content';

const URL_ = 'https://www.bilibili.com/video/BV1cSec6tEux/?spm=1';
const code = '&lt;iframe width="560" src="https://player.bilibili.com/player.html?bvid=BV1cSec6tEux&amp;amp;page=1" title="Bilibili video player"&gt;&lt;/iframe&gt;';

it('drops the share-panel embed code text and leads with a plain link', () => {
	const out = tidyBilibiliContent(`<p>${code}</p><p>面对折叠屏手机</p>`, URL_);
	expect(out).not.toContain('player.bilibili.com');
	expect(out).toContain('面对折叠屏手机');
	expect(out.startsWith('<p><a href="https://www.bilibili.com/video/BV1cSec6tEux/">在 B 站观看</a></p>')).toBe(true);
});

it('keeps a real player iframe and leaves other sites alone', () => {
	const real = '<iframe src="https://player.bilibili.com/player.html?bvid=BV1cSec6tEux"></iframe><p>text</p>';
	expect(tidyBilibiliContent(real, URL_)).toBe(real);
	expect(tidyBilibiliContent(`<p>${code}</p>`, 'https://example.com/a')).toBe(`<p>${code}</p>`);
});
