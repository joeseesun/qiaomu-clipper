import { describe, expect, it } from 'vitest';
import { followXiaoeLink, isXiaoeMedia, playlistIsPlain, playlistSeconds, readXiaoeLive, xiaoeAddress } from './xiaoe';

const APP = 'appfixture123', LIVE = 'l_fixture123456';
const CANON = `https://${APP}.h5.xiaoeknow.com/v4/course/alive/${LIVE}?app_id=${APP}`;
const b64 = (value: object) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
const PLAYLIST = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4.8,\na_1.ts?sign=1\n#EXTINF:5.2,\na_2.ts?sign=1\n#EXT-X-ENDLIST\n';
const MEDIA = 'https://encrypt-k-vod.xet.tech/522ff1e0vodcq1252524126/c99/playlist_eof.m3u8?sign=c7&t=6ac970e6&us=cl';

describe('xiaoeAddress', () => {
	it('reads a live from the web page, its older forms and the mini-program landing page', () => {
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com/v3/course/alive/${LIVE}?type=2&app_id=${APP}`)).toBe(CANON);
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com/v2/course/alive/${LIVE}?app_id=${APP}&pro_id=course_x&type=2`)).toBe(CANON);
		expect(xiaoeAddress(`https://${APP}.mp.xiaoeknow.com/?app_id=${APP}&params=${b64({ app_id: APP, resource_id: LIVE, h5_url: CANON })}`)).toBe(CANON);
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com/content_page/${b64({ type: 12, resource_id: LIVE, app_id: APP })}`)).toBe(CANON);
	});
	it('refuses other shops, other items and look-alike hosts', () => {
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com/v4/course/alive/${LIVE}?app_id=appother1234`)).toBeNull();
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com/p/decorate/personal_center`)).toBeNull();
		expect(xiaoeAddress(`https://${APP}.h5.xiaoeknow.com.evil.cn/v4/course/alive/${LIVE}`)).toBeNull();
		expect(xiaoeAddress(`http://${APP}.h5.xiaoeknow.com/v4/course/alive/${LIVE}`)).toBeNull();
		expect(xiaoeAddress('https://school.xetslk.com/sl/Fixture123')).toBeNull();
	});
});

describe('followXiaoeLink', () => {
	it('follows a short link to the live it names', async () => {
		const landing = `https://${APP}.mp.xiaoeknow.com/?app_id=${APP}&params=${b64({ app_id: APP, resource_id: LIVE })}`;
		const get = (async () => ({ url: landing, text: async () => '' })) as unknown as typeof fetch;
		expect(await followXiaoeLink('https://school.xetslk.com/sl/Fixture123', get)).toBe(CANON);
	});
	it('finds the shop address written in a landing page', async () => {
		const get = (async () => ({ url: 'https://school.xetslk.com/sl/Fixture123', text: async () => `<script>location.href="${CANON.replace('&', '&amp;')}"</script>` })) as unknown as typeof fetch;
		expect(await followXiaoeLink('https://school.xetslk.com/sl/Fixture123', get)).toBe(CANON);
	});
	it('does not fetch addresses of other sites', async () => {
		let called = false; const get = (async () => { called = true; return { url: '', text: async () => '' }; }) as unknown as typeof fetch;
		expect(await followXiaoeLink('https://example.com/x', get)).toBeNull(); expect(called).toBe(false);
	});
});

describe('isXiaoeMedia', () => {
	it('accepts the shop playlists only for the live address itself', () => {
		expect(isXiaoeMedia(CANON, MEDIA)).toBe(true);
		expect(isXiaoeMedia(CANON, 'https://c-vod.hw-cdn.xiaoeknow.com/a/playlist_eof.m3u8?sign=1')).toBe(true);
		expect(isXiaoeMedia(CANON, 'https://evil.example.com/a.m3u8')).toBe(false);
		expect(isXiaoeMedia(CANON, 'https://c-vod.hw-cdn.xiaoeknow.com/a/video.mp4')).toBe(false);
		expect(isXiaoeMedia('https://www.douyin.com/video/1', MEDIA)).toBe(false);
	});
});

describe('playlist', () => {
	it('measures a finished replay and recognises encryption it cannot read', () => {
		expect(playlistSeconds(PLAYLIST)).toBe(10);
		expect(playlistSeconds('<html>')).toBeNull();
		expect(playlistIsPlain(PLAYLIST)).toBe(true);
		expect(playlistIsPlain('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n')).toBe(true);
		expect(playlistIsPlain('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n')).toBe(false);
	});
});

describe('readXiaoeLive', () => {
	const lines = { code: 0, data: [{ line_sharpness: [{ url: 'https://evil.example.com/x.m3u8' }, { url: MEDIA, default: true }] }] };
	const base = { code: 0, data: { alive_info: { title: 'Fixture replay', summary: '整理盘面', product_name: 'Fixture course', zb_start_at: 1791457200, alive_img_url: 'https://wechatapppro.cdn.xiaoeknow.com/a.jpg' }, alive_conf: { wx_app_name: 'Fixture shop' } } };
	it('returns the replay as a study source', async () => {
		const reply = await readXiaoeLive(CANON, async path => path.includes('get_lookback_list') ? lines : base, async () => PLAYLIST);
		expect(reply.ok).toBe(true);
		if (!reply.ok) return;
		expect(reply.address).toBe(CANON);
		expect(reply.info).toMatchObject({ title: 'Fixture replay', author: 'Fixture shop', mediaUrl: MEDIA, seconds: 10, video: true, thumbnail: 'https://wechatapppro.cdn.xiaoeknow.com/a.jpg' });
	});
	it('asks for sign-in when the shop says so', async () => {
		const reply = await readXiaoeLive(CANON, async () => ({ code: 11302, message: 'Redirect.auth.login' }), async () => PLAYLIST);
		expect(reply).toMatchObject({ ok: false, error: 'login' });
		if (!reply.ok && reply.error === 'login') expect(reply.loginUrl).toMatch(new RegExp(`^https://${APP}\\.h5\\.xiaoeknow\\.com/p/t/free/`));
	});
	it('reports a live without a usable replay', async () => {
		expect(await readXiaoeLive(CANON, async () => ({ code: 0, data: [] }), async () => PLAYLIST)).toMatchObject({ ok: false, error: 'no-replay' });
		expect(await readXiaoeLive(CANON, async () => lines, async () => { throw new Error('403'); })).toMatchObject({ ok: false, error: 'no-replay' });
		expect(await readXiaoeLive('https://example.com/', async () => lines, async () => PLAYLIST)).toMatchObject({ ok: false, error: 'not-live' });
	});
});

it('does not mistake a running playlist or unsupported encryption for a finished replay',()=>{
 expect(playlistSeconds(PLAYLIST.replace('#EXT-X-ENDLIST',''))).toBeNull();expect(playlistIsPlain('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128-SAMPLE,URI="key"\n')).toBe(false);
 expect(xiaoeAddress(CANON.replace('.com/', '.com:8080/'))).toBeNull();expect(xiaoeAddress(CANON+'#fragment')).toBeNull();
});
