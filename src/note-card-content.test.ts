// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { noteSourceUrl, pageSelection } from './note-card-content';
import { mountLearningNotes, LearningNotes } from './utils/learning-composer';
import { createLearningDraft, LearningSource } from './utils/learning-record';

const ready = { status: 'ready' as const, vault: 'V', date: '2026-10-04', relativePath: 'Daily/2026-10-04.md', targetToken: 't' };
const services = () => ({ createLearningDraft, loadLearningDraft: vi.fn(async () => null), persistLearningDraft: vi.fn(async () => {}), getDailyTarget: vi.fn(async () => ready), saveLearningRecord: vi.fn(), dispatchLearningRecord: vi.fn() });
let notes: LearningNotes | undefined;
afterEach(() => { notes?.dispose(); notes = undefined; document.body.innerHTML = ''; document.getSelection()?.removeAllRanges(); });

it('links to the plain page, and to the plain watch link for YouTube', () => {
	expect(noteSourceUrl('https://example.com/post?id=3#section')).toBe('https://example.com/post?id=3');
	expect(noteSourceUrl('https://www.youtube.com/watch?v=abcdefghijk&list=PL1&t=30s&pp=x#c')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
});

it('takes the selection from anywhere on the page, but not from the note card itself', () => {
	document.body.innerHTML = '<div id="a">Chosen words</div><dialog class="learning-composer"><p id="own">Mine</p></dialog>';
	const select = (id: string) => { const range = document.createRange(); range.selectNodeContents(document.getElementById(id)!); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); };
	select('a'); expect(pageSelection(document)).toBe('Chosen words');
	select('own'); expect(pageSelection(document)).toBe('');
});

it('stamps a video page note with the playhead and leaves the N key to the page', async () => {
	document.body.innerHTML = '<article></article>';
	const source: LearningSource = { title: 'Video', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
	notes = mountLearningNotes({ doc: document, singleKey: false, getTime: () => 125, getSource: () => source, services: services() });
	document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
	expect(document.querySelector<HTMLDialogElement>('.learning-composer')!.open).toBe(false);
	await notes.open({});
	for (let i = 0; i < 20; i++) await Promise.resolve();
	expect(document.querySelector<HTMLInputElement>('[aria-label="视频时间（秒）"]')!.value).toBe('125');
});
