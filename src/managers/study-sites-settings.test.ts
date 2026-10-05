// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('../utils/browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
import { initializeStudySitesSettings } from './study-sites-settings';
import { STUDY_SITES } from '../utils/study-sites';

const settled = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const box = (id: string) => document.getElementById(`study-site-${id}`) as HTMLInputElement;
const toggle = (id: string, on: boolean) => { box(id).checked = on; box(id).dispatchEvent(new Event('change')); };
const saved = () => state.store.qiaomuStudySites as { off: string[]; other: boolean } | undefined;
beforeEach(async () => { state.store = {}; document.body.innerHTML = '<div id="study-sites-list"></div>'; await initializeStudySitesSettings(); });

it('lists every site and "other sites", all switched on to begin with', () => {
	expect(Array.from(document.querySelectorAll<HTMLElement>('#study-sites-list [data-site]')).map(r => r.dataset.site)).toEqual([...STUDY_SITES.map(s => s.id), 'other']);
	expect(Array.from(document.querySelectorAll<HTMLInputElement>('#study-sites-list input')).every(i => i.checked)).toBe(true); expect(document.body.textContent).toContain('字幕条、沉浸学习'); expect(saved()).toBeUndefined(); // nothing is stored until something changes
});

it('remembers what is switched off, and switched on again', async () => {
	toggle('tiktok', false); toggle('youtube', false); toggle('other', false); await settled();
	expect(saved()).toEqual({ off: ['tiktok', 'youtube'], other: false }); toggle('tiktok', true); await settled(); expect(saved()).toEqual({ off: ['youtube'], other: false });
	document.body.innerHTML = '<div id="study-sites-list"></div>'; await initializeStudySitesSettings(); expect(box('youtube').checked).toBe(false); expect(box('tiktok').checked).toBe(true); expect(box('other').checked).toBe(false); expect(box('vimeo').checked).toBe(true);
});

it('does nothing on a page without the list', async () => { document.body.innerHTML = ''; await expect(initializeStudySitesSettings()).resolves.toBeUndefined(); });
