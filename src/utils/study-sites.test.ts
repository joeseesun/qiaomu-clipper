import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
import { STUDY_SITES, cleanStudySites, defaultStudySites, isSiteOn, loadStudySites, saveStudySites, siteOf } from './study-sites';
beforeEach(() => { state.store = {}; });

it('has everything switched on until the viewer turns something off', async () => {
	expect(await loadStudySites()).toEqual({ off: [], other: true }); expect(defaultStudySites()).toEqual({ off: [], other: true }); expect(STUDY_SITES.every(site => isSiteOn(defaultStudySites(), site.id))).toBe(true);
	expect(STUDY_SITES.filter(s => s.builtin).map(s => s.id)).toEqual(['youtube', 'bilibili', 'xiaoyuzhou']); expect(new Set(STUDY_SITES.map(s => s.id)).size).toBe(STUDY_SITES.length);
});

it('saves what is switched off, and repairs anything malformed instead of trusting it', async () => {
	await saveStudySites({ off: ['tiktok', 'tiktok', 'nope', 5 as never], other: false }); expect(await loadStudySites()).toEqual({ off: ['tiktok'], other: false });
	expect(isSiteOn(await loadStudySites(), 'tiktok')).toBe(false); expect(isSiteOn(await loadStudySites(), 'vimeo')).toBe(true);
	for (const bad of ['x', null, 5, { off: 'tiktok', other: 'no' }, { off: [null] }]) expect(cleanStudySites(bad)).toEqual({ off: [], other: true });
	state.store.qiaomuStudySites = 'garbage'; expect(await loadStudySites()).toEqual({ off: [], other: true });
});

it('knows which site an address belongs to, subdomains included, and never matches a look-alike', () => {
	expect(siteOf('https://vimeo.com/123')!.id).toBe('vimeo'); expect(siteOf('https://player.vimeo.com/video/1')!.id).toBe('vimeo'); expect(siteOf('https://www.youtube.com/watch?v=x')!.id).toBe('youtube'); expect(siteOf('https://music.163.com/song?id=1')!.id).toBe('netease'); expect(siteOf('https://x.com/a/status/1')!.id).toBe('x');
	for (const none of ['https://notvimeo.com/1', 'https://vimeo.com.evil.example/1', 'https://example.com', 'ftp://vimeo.com', 'nope']) expect(siteOf(none), none).toBeUndefined();
});
