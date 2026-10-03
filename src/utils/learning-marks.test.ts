// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: env.data[key] }), set: async (value: Record<string, unknown>) => Object.assign(env.data, value) } } } }));
import { addMark, loadMarks, renderMarks } from './learning-marks';

const page = 'https://www.youtube.com/watch?v=dbqweBCynuI';
const transcript = (...starts: number[]) => { document.body.innerHTML = '<article>' + starts.map(t => `<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="${t}">${t}</span></strong> line ${t}</p>`).join('') + '</article>'; return document.querySelector('article')!; };
beforeEach(() => { env.data = {}; });

it('stores marks per video and part, dedupes by note, trims snippets and ignores non-video pages', async () => {
	await addMark(page, { t: 24.9, text: '  first\n  note ', at: 'a' }); await addMark(page, { t: 30, text: 'second', at: 'b' }); await addMark(page, { t: 31, text: 'second edited', at: 'b' });
	expect(await loadMarks(page)).toEqual([{ t: 24, text: 'first note', at: 'a' }, { t: 31, text: 'second edited', at: 'b' }]);
	expect(await loadMarks('https://www.bilibili.com/video/BV1cSec6tEux?p=2')).toEqual([]);
	await addMark('https://example.com/article', { t: 5, text: 'web', at: 'c' }); expect(await loadMarks('https://example.com/article')).toEqual([]);
	await addMark(page, { t: -1, text: 'bad', at: 'd' }); expect((await loadMarks(page)).some(mark => mark.at === 'd')).toBe(false);
	env.data['qiaomuLearningMarks:youtube:dbqweBCynuI'] = 'corrupt'; expect(await loadMarks(page)).toEqual([]);
});

it('marks the transcript line that was playing at the note time, joins several notes and clears stale marks', () => {
	const article = transcript(0, 12, 24, 36);
	renderMarks(article, [{ t: 30, text: 'a', at: '1' }, { t: 25, text: 'b', at: '2' }, { t: 99, text: 'late', at: '3' }]);
	const lines = Array.from(article.querySelectorAll('.transcript-segment'));
	expect(lines.map(line => line.classList.contains('has-note'))).toEqual([false, false, true, true]);
	expect(lines[2].querySelector('strong')!.title).toBe('笔记：a / b'); expect(lines[3].querySelector('strong')!.title).toContain('late');
	renderMarks(article, []); expect(article.querySelector('.has-note')).toBeNull(); expect(article.querySelector('strong')!.hasAttribute('title')).toBe(false);
	renderMarks(article, [{ t: 0, text: 'x', at: '4' }]); expect(lines[0].classList.contains('has-note')).toBe(true);
});
