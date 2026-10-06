// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cleanNotes, markTimestamps, parsePodcastPage, podcastAudioUrl, stampSeconds } from './podcast-page';

const PAGE = (audio = 'https://media.xyzcdn.net/626b/abc.m4a', notes = '<p>开场 00:00</p><p>第二部分 12:30，结尾 1:02:03</p><script>alert(1)</script><img src="https://image.xyzcdn.net/a.png" onerror="x()"><a href="https://example.com/a">链接 10:10</a>') => `<html><head>
<meta property="og:title" content="153. 和曾鸣聊产业史观 - 张小珺Jùn | 商业访谈录 | 小宇宙 - 听播客，上小宇宙"/><meta property="og:image" content="https://image.xyzcdn.net/cover.png"/><meta property="og:audio" content="${audio}"/></head>
<body><main><header><h1>153. 和曾鸣聊产业史观</h1><div class="podcast-title"><a class="name" href="/podcast/x">张小珺Jùn｜商业访谈录</a></div><div class="info">154分钟<time datetime="2026-09-03T00:00:00.000Z">1 个月前</time></div></header>
<section aria-label="节目show notes"><div class="sn-content"><article>${notes}</article></div></section></main></body></html>`;

it('reads the episode: title, show, cover, date, length, audio and show notes', () => {
	const episode = parsePodcastPage(PAGE());
	expect(episode).toMatchObject({ title: '153. 和曾鸣聊产业史观', show: '张小珺Jùn｜商业访谈录', cover: 'https://image.xyzcdn.net/cover.png', date: '2026-09-03', minutes: 154, audio: 'https://media.xyzcdn.net/626b/abc.m4a' });
	expect(episode.notesHtml).toContain('开场');
});

it('only accepts audio on the platform\'s own media host over https', () => {
	for (const bad of ['https://evil.example/a.m4a', 'http://media.xyzcdn.net/a.m4a', 'https://xyzcdn.net.evil.example/a.m4a', 'javascript:alert(1)']) expect(() => parsePodcastPage(PAGE(bad))).toThrow();
	expect(() => podcastAudioUrl(new DOMParser().parseFromString('<html></html>', 'text/html'))).toThrow('音频地址');
	expect(podcastAudioUrl(new DOMParser().parseFromString('<html></html>', 'text/html'), '"enclosure":{"url":"https://media.xyzcdn.net/q.m4a"}')).toBe('https://media.xyzcdn.net/q.m4a');
});

it('keeps the show notes\' formatting, drops anything active, and turns timestamps into jump marks (but not inside links)', () => {
	const html = parsePodcastPage(PAGE()).notesHtml, holder = document.createElement('div'); holder.innerHTML = html;
	expect(html).not.toContain('<script'); expect(html).not.toContain('onerror'); expect(holder.querySelector('img')!.getAttribute('loading')).toBe('lazy');
	expect(Array.from(holder.querySelectorAll<HTMLElement>('a.qiaomu-seek')).map(a => [a.textContent, a.dataset.time])).toEqual([['00:00', '0'], ['12:30', '750'], ['1:02:03', '3723']]);
	const link = holder.querySelector<HTMLAnchorElement>('a[href^="https://example.com"]')!; expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener'); expect(link.querySelector('.qiaomu-seek')).toBeNull();
});

it('reads clock-like times only: not decimals, scores or longer numbers', () => {
	const root = document.createElement('div'); root.textContent = 'ratio 3:2:1 and 1.5:30 version 10.12.3 at 7:05 or 61:00'; markTimestamps(root);
	expect(Array.from(root.querySelectorAll<HTMLElement>('a')).map(a => a.textContent)).toEqual(['7:05']);
	expect(stampSeconds(undefined, '7', '05')).toBe(425); expect(stampSeconds('1', '02', '03')).toBe(3723); expect(cleanNotes('<p>x</p>')).toBe('<p>x</p>');
});

it('turns a plain description into paragraphs, links and jumpable times, escaping everything else', async () => {
	const { plainToHtml, durationText } = await import('./podcast-page');
	const html = plainToHtml('Introducing <b>x</b> & more\nsecond line\n\nSee https://huggingface.co/interfaze-ai/interfaze-1-lite-with-a-very-long-path/files for 12:30 details');
	const holder = document.createElement('div'); holder.innerHTML = html;
	expect(holder.querySelectorAll('p')).toHaveLength(2); expect(holder.querySelector('p')!.innerHTML).toBe('Introducing &lt;b&gt;x&lt;/b&gt; &amp; more<br>second line'); expect(holder.querySelector('b')).toBeNull();
	const link = holder.querySelector<HTMLAnchorElement>('a[href^="https://huggingface"]')!; expect(link.textContent!.endsWith('…')).toBe(true); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener'); expect(holder.querySelector<HTMLElement>('a.qiaomu-seek')!.dataset.time).toBe('750');
	expect(plainToHtml('')).toBe(''); expect(plainToHtml('<script>x()</script>')).not.toContain('<script');
	expect([0, NaN, 45, 115, 599, 600, 3000, 3600, 9258].map(durationText)).toEqual(['', '', '45 秒', '1:55', '9:59', '10 分钟', '50 分钟', '1 小时 0 分钟', '2 小时 34 分钟']);
});
