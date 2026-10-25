// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountChatTurnNavigation } from './chat-turn-navigation';
import type { StoredTurn } from './chat-history';

let cleanup: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { cleanup?.(); vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(count = 4, save = vi.fn().mockResolvedValue(undefined)) {
	const area = document.createElement('div'), viewport = document.createElement('div'), list = document.createElement('div');
	viewport.append(list); area.append(viewport); document.body.append(area);
	let top = 0, height = count * 500, width = 360;
	const writes = vi.fn();
	Object.defineProperties(viewport, { scrollTop: { get: () => top, set: v => { writes(v); top = Math.max(0, Math.min(v, height - 400)); } }, clientHeight: { value: 400 }, scrollHeight: { get: () => height } });
	const rect = (y: number, h: number) => ({ top: y, bottom: y + h, height: h, left: 0, right: width, width, x: 0, y, toJSON() {} });
	viewport.getBoundingClientRect = () => rect(100, 400); area.getBoundingClientRect = () => rect(100, 400);
	const nav = mountChatTurnNavigation({ area, viewport, list, onBookmark: save }); cleanup = nav.destroy;
	const turns: StoredTurn[] = [], questions: HTMLElement[] = [];
	for (let i = 0; i < count; i++) {
		const turn: StoredTurn = { role: 'user', content: `Question ${i + 1}` };
		const question = document.createElement('div'); question.textContent = turn.content; question.getBoundingClientRect = () => rect(100 + i * 500 - top, 60);
		const answer = document.createElement('div'); answer.innerHTML = `<div class="clip-chat-body">Answer ${i + 1}</div>`;
		list.append(question); nav.add(turn, question); list.append(answer); nav.add({ role: 'assistant', content: '' }, answer); turns.push(turn); questions.push(question);
	}
	nav.refresh();
	const markers = Array.from(area.querySelectorAll<HTMLButtonElement>('.clip-chat-turn-marker'));
	const preview = area.querySelector<HTMLElement>('.clip-chat-turn-preview')!, bookmark = area.querySelector<HTMLButtonElement>('.clip-chat-turn-bookmark')!;
	markers.forEach((marker, i) => { marker.getBoundingClientRect = () => rect(112 + i * 12, 12); });
	Object.defineProperty(preview, 'offsetHeight', { value: 120 });
	return { nav, area, viewport, list, turns, questions, markers, preview, bookmark, writes, save,
		scroll: (value: number) => { top = value; nav.refresh(); }, grow: () => { height += 500; nav.refresh(); },
		resize: (value: number) => { width = value; nav.refresh(); },
		hover: async (i: number) => { markers[i].dispatchEvent(new Event('pointerenter')); await vi.advanceTimersByTimeAsync(100); }
	};
}

it('tracks the visible turn and bottom without ever scrolling the conversation on layout or stream growth', () => {
	const ui = setup(); expect(ui.markers[0].getAttribute('aria-current')).toBe('location');
	ui.scroll(560); expect(ui.markers[1].classList.contains('is-current')).toBe(true);
	ui.scroll(1600); expect(ui.markers[3].classList.contains('is-current')).toBe(true);
	ui.grow(); expect(ui.writes).not.toHaveBeenCalled();
});

it('keeps each marker bound to its original question and reply when new turns append, stream, scroll and bookmark', async () => {
	const ui = setup(2);
	const originalMarkers = [...ui.markers];
	const controls = originalMarkers.map(marker => marker.getAttribute('aria-controls'));
	await ui.hover(1);
	expect(ui.preview.textContent).toContain('Question 2'); expect(ui.preview.textContent).toContain('Answer 2');
	const question = document.createElement('div'); question.textContent = 'Question 3';
	const answer = document.createElement('div'); answer.innerHTML = '<div class="clip-chat-body">Answer 3 streaming</div>';
	ui.list.append(question); ui.nav.add({ role: 'user', content: 'Question 3' }, question);
	ui.list.append(answer); ui.nav.add({ role: 'assistant', content: '' }, answer); ui.grow();
	const markers = Array.from(ui.area.querySelectorAll<HTMLButtonElement>('.clip-chat-turn-marker'));
	expect(markers.slice(0, 2)).toEqual(originalMarkers);
	expect(markers.map(marker => document.getElementById(marker.getAttribute('aria-controls')!)?.textContent)).toEqual(['Question 1', 'Question 2', 'Question 3']);
	expect(ui.preview.textContent).toContain('Answer 2'); expect(ui.preview.textContent).not.toContain('Answer 3');
	answer.firstElementChild!.textContent += ' completed'; ui.scroll(550);
	ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0);
	expect(ui.save).toHaveBeenCalledWith(ui.turns[1]);
	expect(originalMarkers.map(marker => marker.getAttribute('aria-controls'))).toEqual(controls);
	for (let i = 0; i < markers.length; i++) {
		markers[i].dispatchEvent(new Event('pointerenter')); await vi.advanceTimersByTimeAsync(100);
		expect(ui.preview.querySelector('.clip-chat-turn-preview-title')!.textContent).toBe(`Question ${i + 1}`);
		expect(ui.preview.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe(i === 2 ? 'Answer 3 streaming completed' : `Answer ${i + 1}`);
	}
	expect(ui.writes).not.toHaveBeenCalled();
});

it('hides the navigator and preview in a narrow panel and restores bookmarks and reading position when widened', async () => {
	const ui = setup(); ui.scroll(560); await ui.hover(2); ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0);
	ui.resize(320); expect(ui.area.querySelector<HTMLElement>('nav')!.hidden).toBe(true);
	expect(ui.preview.hidden).toBe(true); expect(ui.area.classList.contains('has-turn-navigation')).toBe(false);
	ui.resize(480); expect(ui.area.querySelector<HTMLElement>('nav')!.hidden).toBe(false);
	expect(ui.markers[1].getAttribute('aria-current')).toBe('location'); expect(ui.markers[2].classList.contains('is-bookmarked')).toBe(true);
	expect(ui.writes).not.toHaveBeenCalled(); expect(ui.save).toHaveBeenCalledTimes(1);
});

it('opens a safe question/answer preview, supports crossing into it, and dismisses after leaving', async () => {
	const ui = setup(); ui.turns[1].content = '<img src=x onerror=alert(1)> Long question';
	await ui.hover(1); expect(ui.preview.hidden).toBe(false); expect(ui.preview.textContent).toContain('Answer 2');
	const described = ui.area.querySelector('.clip-chat-turn-preview-jump')!.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent).join(' ');
	expect(described).toContain('Answer 2'); expect(described).toContain('第 2 轮');
	expect(ui.preview.querySelector('img')).toBeNull();
	const rail = ui.area.querySelector('nav')!;
	rail.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: ui.preview })); ui.preview.dispatchEvent(new Event('pointerenter'));
	await vi.advanceTimersByTimeAsync(200); expect(ui.preview.hidden).toBe(false);
	ui.preview.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: document.body }));
	await vi.advanceTimersByTimeAsync(200); expect(ui.preview.hidden).toBe(true);
	expect(ui.writes).not.toHaveBeenCalled();
});

it('keeps bookmark and current-location states independent, saves without jumping, and can undo the bookmark', async () => {
	const ui = setup(); await ui.hover(2); ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0);
	expect(ui.save).toHaveBeenCalledWith(ui.turns[2]); expect(ui.turns[2].bookmarked).toBe(true);
	expect(ui.markers[2].classList.contains('is-bookmarked')).toBe(true); expect(ui.markers[0].classList.contains('is-current')).toBe(true);
	ui.scroll(1000); expect(ui.markers[2].classList.contains('is-current')).toBe(true); expect(ui.markers[2].classList.contains('is-bookmarked')).toBe(true);
	expect(ui.preview.textContent).toContain('已收藏 · 当前阅读');
	ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0); expect(ui.turns[2].bookmarked).toBe(false); expect(ui.writes).not.toHaveBeenCalled();
});

it('reports a failed save, rolls back the bookmark and permits retry', async () => {
	const ui = setup(4, vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined));
	await ui.hover(1); ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0);
	expect(ui.turns[1].bookmarked).toBe(false); expect(ui.preview.textContent).toContain('收藏未能保存'); expect(ui.bookmark.disabled).toBe(false);
	ui.bookmark.click(); await vi.advanceTimersByTimeAsync(0); expect(ui.turns[1].bookmarked).toBe(true);
});

it('jumps to the requested question only on activation and transfers reading focus without another scroll', async () => {
	const ui = setup(); ui.markers[2].click(); expect(ui.viewport.scrollTop).toBe(986); expect(document.activeElement).toBe(ui.questions[2]);
	await ui.hover(1); ui.area.querySelector<HTMLButtonElement>('.clip-chat-turn-preview-jump')!.click();
	expect(ui.viewport.scrollTop).toBe(486); expect(ui.preview.hidden).toBe(true); expect(ui.writes).toHaveBeenCalledTimes(2);
	ui.grow(); expect(ui.writes).toHaveBeenCalledTimes(2);
});

it('supports keyboard exploration, bookmark focus and Escape without moving the reading position', () => {
	const ui = setup(); ui.markers[0].focus();
	ui.markers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); expect(document.activeElement).toBe(ui.markers[1]);
	expect(ui.markers[1].tabIndex).toBe(0); expect(ui.markers[0].tabIndex).toBe(-1); expect(ui.markers[0].getAttribute('aria-current')).toBe('location');
	ui.markers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(document.activeElement).toBe(ui.bookmark);
	ui.bookmark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	expect(document.activeElement).toBe(ui.markers[1]); expect(ui.preview.hidden).toBe(true); expect(ui.writes).not.toHaveBeenCalled();
});

it('clamps previews within the panel, removes failed turns, clears new conversations and cancels pending hover on destroy', async () => {
	const ui = setup(35); await ui.hover(34); expect(parseFloat(ui.preview.style.top)).toBe(276);
	ui.questions[34].remove(); ui.nav.refresh(); expect(ui.preview.hidden).toBe(true); expect(ui.area.querySelectorAll('.clip-chat-turn-marker')).toHaveLength(34);
	ui.nav.reset(); expect(ui.area.querySelectorAll('.clip-chat-turn-marker')).toHaveLength(0); expect(ui.area.querySelector<HTMLElement>('nav')!.hidden).toBe(true);
	ui.markers[1].dispatchEvent(new Event('pointerenter')); ui.nav.destroy(); await vi.advanceTimersByTimeAsync(200); expect(ui.area.querySelector('nav')).toBeNull();
});


it('mounts without a scroll-feature wrapper, updates after streamed DOM changes, and restores the original viewport on destroy', async () => {
	const panel = document.createElement('div'), viewport = document.createElement('div');
	panel.append(viewport); document.body.append(panel);
	const nav = mountChatTurnNavigation({ viewport, onBookmark: vi.fn().mockResolvedValue(undefined) }); cleanup = nav.destroy;
	const area = panel.querySelector<HTMLElement>('.clip-chat-nav-area')!;
	area.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 400, right: 400, width: 400, height: 400, x: 0, y: 0, toJSON() {} });
	Object.defineProperties(viewport, { clientHeight: { value: 400 }, scrollHeight: { value: 1000 } });
	const question = document.createElement('div'), answer = document.createElement('div');
	viewport.append(question, answer); answer.innerHTML = '<div class="clip-chat-body">Initial answer</div>';
	nav.add({ role: 'user', content: 'Standalone question' }, question); nav.add({ role: 'assistant', content: '' }, answer);
	const marker = area.querySelector<HTMLButtonElement>('.clip-chat-turn-marker')!;
	marker.dispatchEvent(new Event('pointerenter')); await vi.advanceTimersByTimeAsync(100);
	expect(area.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe('Initial answer');
	answer.firstElementChild!.textContent = 'Streamed answer';
	await vi.advanceTimersByTimeAsync(40);
	expect(area.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe('Streamed answer');
	nav.destroy(); expect(viewport.parentElement).toBe(panel); expect(panel.querySelector('nav')).toBeNull();
});
