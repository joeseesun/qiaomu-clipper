// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, create: vi.fn(), put: vi.fn() }));
vi.mock('../utils/browser-polyfill', () => ({ default: { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }, tabs: { create: (...args: unknown[]) => state.create(...args) }, storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
vi.mock('../utils/file-handoff', () => ({ putHandedFile: (...args: unknown[]) => state.put(...args) }));
vi.mock('../utils/podcast-feed', async importOriginal => ({ ...(await importOriginal<typeof import('../utils/podcast-feed')>()), fetchFeed: async () => { throw new Error('offline'); } }));
import { initializeStudyHome } from './study-home-settings';

const EP = '6a97f287f03e74ee6b03ea5b';
const input = () => document.querySelector<HTMLInputElement>('.qiaomu-home-form input')!;
const type = (value: string) => { input().value = value; input().dispatchEvent(new Event('input')); };
const settled = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(async () => { state.store = {}; state.create.mockReset(); state.put.mockReset(); document.body.innerHTML = '<div id="study-home"></div>'; await initializeStudyHome(); });

it('draws the study page inside the settings page, beside the menu, without taking over the document', () => {
	expect(document.querySelector('#study-home .qiaomu-home.is-embedded')).not.toBeNull(); expect(document.querySelector('#study-home h1')).toBeNull(); // the settings page has its own heading
	expect(document.querySelector('#study-home')!.textContent).toContain('推荐播客'); expect(document.querySelector('#study-home')!.textContent).toContain('选择本地文件'); expect(document.title).not.toBe('转写学习');
});

it('opens a study in a tab of its own, and keeps the settings page where it is', () => {
	type(`https://www.xiaoyuzhoufm.com/episode/${EP}`); document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
	expect(state.create).toHaveBeenCalledWith({ url: expect.stringContaining('chrome-extension://test/reader.html?study=audio') });
});

it('hands a chosen file to the study page through a token, and falls back to asking again where that is not possible', async () => {
	const files = document.querySelector<HTMLInputElement>('input[type=file]')!, talk = new File(['x'], 'talk.m4a');
	Object.defineProperty(files, 'files', { value: [talk], configurable: true }); state.put.mockResolvedValueOnce('a'.repeat(24)); files.dispatchEvent(new Event('change')); await settled();
	expect(state.put).toHaveBeenCalledWith(talk); expect(state.create).toHaveBeenLastCalledWith({ url: 'chrome-extension://test/reader.html?study=file&token=' + 'a'.repeat(24) });
	state.put.mockResolvedValueOnce(undefined); files.dispatchEvent(new Event('change')); await settled(); expect(state.create).toHaveBeenLastCalledWith({ url: 'chrome-extension://test/reader.html?study=file' });
});

it('looks again at what was studied each time the page is shown, and at the sites that were switched off', async () => {
	expect(document.querySelector('.qiaomu-home-item')).toBeNull();
	state.store.qiaomuStudyRecent = [{ url: `https://www.xiaoyuzhoufm.com/episode/${EP}`, title: 'An episode', kind: 'podcast', at: Date.now() }]; document.dispatchEvent(new CustomEvent('qiaomu-study-shown')); await settled();
	expect(document.querySelector('.qiaomu-home-item')!.textContent).toContain('An episode');
	state.store.qiaomuStudySites = { off: ['xiaoyuzhou'], other: true }; type(`https://www.xiaoyuzhoufm.com/episode/${EP}`); document.dispatchEvent(new CustomEvent('qiaomu-study-shown')); await settled(); expect(document.querySelector('.qiaomu-home-hint')!.textContent).toContain('网页（普通阅读）');
});

it('does nothing on a page without the study area', async () => { document.body.innerHTML = ''; await expect(initializeStudyHome()).resolves.toBeUndefined(); });
