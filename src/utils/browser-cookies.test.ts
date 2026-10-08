import { describe, expect, it } from 'vitest';
import { cookieDomainsFor, cookiesTxtFor, netscapeCookies, videoAddress } from './browser-cookies';

const cookie = (extra = {}) => ({ domain: '.youtube.com', path: '/', secure: true, httpOnly: false, name: 'SID', value: 'abc', expirationDate: 1800000000.5, ...extra });

describe('browser cookies for the download tool', () => {
	it('writes the Netscape format, with HttpOnly marked and tabs kept out of values', () => {
		const text = netscapeCookies([cookie(), cookie({ httpOnly: true, name: 'HSID', value: 'a\tb', domain: 'www.youtube.com' })]);
		expect(text.split('\n')).toEqual(['# Netscape HTTP Cookie File', '.youtube.com\tTRUE\t/\tTRUE\t1800000000\tSID\tabc', '#HttpOnly_www.youtube.com\tFALSE\t/\tTRUE\t1800000000\tHSID\ta b', '']);
	});
	it('names the sites a video needs', () => {
		expect(cookieDomainsFor('https://www.youtube.com/watch?v=x')).toEqual(['youtube.com', 'google.com']);
		expect(cookieDomainsFor('https://www.bilibili.com/video/BV1')).toEqual(['bilibili.com']);
		expect(cookieDomainsFor('https://example.co.uk/a')).toEqual(['example.co.uk']);
		expect(cookieDomainsFor('nonsense')).toEqual([]);
	});
	it('finds the page of a video key', () => {
		expect(videoAddress('youtube:x2VHFgyawPE')).toBe('https://www.youtube.com/watch?v=x2VHFgyawPE');
		expect(videoAddress('web:abc', 'https://v.douyin.com/z')).toBe('https://v.douyin.com/z');
		expect(videoAddress('xiaoyuzhou:1')).toBeUndefined();
	});
	it('collects each site once, and gives nothing when there are no cookies or the browser refuses', async () => {
		const asked: string[] = [];
		const text = await cookiesTxtFor('https://www.youtube.com/watch?v=x', async ({ domain }) => { asked.push(domain); return [cookie()]; });
		expect(asked).toEqual(['youtube.com', 'google.com']);
		expect(text.match(/\tSID\t/g)).toHaveLength(1);
		expect(await cookiesTxtFor('https://a.com/', async () => [])).toBe('');
		expect(await cookiesTxtFor('https://a.com/', async () => { throw new Error('no'); })).toBe('');
		expect(await cookiesTxtFor(undefined, async () => [cookie()])).toBe('');
	});
});
