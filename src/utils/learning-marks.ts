import browser from './browser-polyfill';
import { videoKey } from './video-source';

import { t } from './ui-text';
// A small local index of where you took notes in a video, so the transcript can show them. The notes
// themselves live in the daily note; this only remembers the second and a short snippet for the tooltip.
export interface NoteMark { t: number; text: string; at: string }
export const MARKS_EVENT = 'qiaomu-learning-marks';
const MAX_MARKS = 300;
const storageKey = (key: string) => `qiaomuLearningMarks:${key}`;

export async function loadMarks(sourceUrl: string): Promise<NoteMark[]> {
	const key = videoKey(sourceUrl); if (!key) return [];
	try {
		const value = (await browser.storage.local.get(storageKey(key)))[storageKey(key)];
		return Array.isArray(value) ? value.filter((mark): mark is NoteMark => Number.isFinite(mark?.t) && typeof mark?.text === 'string') : [];
	} catch { return []; }
}

export async function addMark(sourceUrl: string, mark: NoteMark): Promise<void> {
	const key = videoKey(sourceUrl); if (!key || !Number.isFinite(mark.t) || mark.t < 0) return;
	try {
		const marks = (await loadMarks(sourceUrl)).filter(item => item.at !== mark.at);
		marks.push({ t: Math.floor(mark.t), text: mark.text.replace(/\s+/g, ' ').trim().slice(0, 140), at: mark.at });
		await browser.storage.local.set({ [storageKey(key)]: marks.slice(-MAX_MARKS) });
	} catch { /* marks are a convenience; the note itself is already saved */ }
}

// The transcript line a note belongs to is the last one that starts at or before its time.
export function renderMarks(root: ParentNode, marks: NoteMark[]): void {
	const segments = Array.from(root.querySelectorAll<HTMLElement>('.transcript-segment'));
	for (const segment of segments) { segment.classList.remove('has-note'); segment.querySelector('strong')?.removeAttribute('title'); }
	if (!marks.length) return;
	const starts = segments.map(segment => Number(segment.querySelector('.timestamp')?.getAttribute('data-timestamp')));
	const byIndex = new Map<number, string[]>();
	for (const mark of marks) {
		let index = -1;
		for (let i = 0; i < starts.length; i++) if (Number.isFinite(starts[i]) && starts[i] <= mark.t) index = i; else if (Number.isFinite(starts[i]) && starts[i] > mark.t) break;
		if (index >= 0) byIndex.set(index, [...(byIndex.get(index) || []), mark.text]);
	}
	for (const [index, texts] of byIndex) {
		segments[index].classList.add('has-note');
		const stamp = segments[index].querySelector('strong'); if (stamp) stamp.title = t('笔记：') + texts.filter(Boolean).join(' / ');
	}
}
