import { expect, it } from 'vitest';
import { bilibiliEmbedsToLinks, normalizeBilibiliEmbeds } from './bilibili-embed';

const defuddle = '<iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid=BV1cSec6tEux&amp;page=2&amp;high_quality=1&amp;danmaku=0" title="Bilibili video player" frameborder="0" allowfullscreen=""></iframe>';

it('rewrites the extracted embed into a player that loads on an outside page', () => {
	const out = normalizeBilibiliEmbeds(`${defuddle}\n\n正文`);
	expect(out).toContain('src="https://player.bilibili.com/player.html?isOutside=true&bvid=BV1cSec6tEux&p=2&autoplay=0');
	expect(out.endsWith('</iframe>\n\n正文')).toBe(true);
});

it('turns embeds into a plain link for the RSS site, including a cut-off tag', () => {
	expect(bilibiliEmbedsToLinks(`${defuddle}\n\n正文`)).toBe('[▶ 在 B 站观看](https://www.bilibili.com/video/BV1cSec6tEux/?p=2)\n\n正文');
	expect(bilibiliEmbedsToLinks('<iframe src="https://player.bilibili.com/player.html?bvid=BV1cSec6tEux" allowfullscreen=""</iframe\n\n正文')).toBe('[▶ 在 B 站观看](https://www.bilibili.com/video/BV1cSec6tEux/)\n\n正文');
});

it('leaves other iframes and unrelated text alone', () => {
	const other = '<iframe src="https://example.com/embed"></iframe> text';
	const escaped = '&lt;iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid=BV1GjaD6jEVx&amp;page=1&amp;high_quality=1&amp;danmaku=0" title="Bilibili video player" frameborder="0" allowfullscreen=""&gt;&lt;/iframe&gt;';
	expect(bilibiliEmbedsToLinks(`前文\n\n${escaped}\n\n后文`)).toBe('前文\n\n[▶ 在 B 站观看](https://www.bilibili.com/video/BV1GjaD6jEVx/)\n\n后文');
	expect(bilibiliEmbedsToLinks(other)).toBe(other); expect(normalizeBilibiliEmbeds(other)).toBe(other);
});
