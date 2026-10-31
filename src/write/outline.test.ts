// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, it, vi } from 'vitest';
import { buildExtensions } from './editor/extensions';
import { activeHeading, headingsOf, mountOutline } from './outline';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; document.body.textContent = ''; });
const make = (markdown: string) => { editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: markdown }); return editor; };

it('lists headings with their level and position', () => {
	const items = headingsOf(make('# 一\n\n正文\n\n## 二\n\n### 三'));
	expect(items.map(i => [i.text, i.level])).toEqual([['一', 1], ['二', 2], ['三', 3]]);
});

it('picks the heading the reader has scrolled past', () => {
	expect(activeHeading([-400, -50, 300, 900])).toBe(1);
	expect(activeHeading([200, 500])).toBe(0);
	expect(activeHeading([-10, 40, 96, 97])).toBe(2);
});

it('shows title and headings when open, ticks when folded, and hides itself without headings', async () => {
	localStorage.setItem('qiaomuWriteOutline', 'open');
	const ed = make('# 甲\n\n## 乙');
	const aside = document.body.appendChild(document.createElement('aside'));
	const rail = mountOutline(aside, () => ed, () => '我的文章');
	rail.refresh();
	await new Promise(resolve => setTimeout(resolve, 260));
	expect(aside.hidden).toBe(false);
	expect(aside.querySelector('.qw-ol-title')!.textContent).toBe('我的文章');
	expect(Array.from(aside.querySelectorAll('.qw-ol-item')).map(i => i.textContent)).toEqual(['甲', '乙']);
	rail.toggle();
	expect(aside.dataset.mode).toBe('tick');
	expect(aside.querySelectorAll('.qw-ol-tick').length).toBe(2);
	expect(aside.querySelector('.qw-ol-tick.l1')).not.toBeNull();
	ed.commands.setContent('只有正文');
	rail.refresh();
	await new Promise(resolve => setTimeout(resolve, 260));
	expect(aside.hidden).toBe(true);
	rail.destroy();
});

it('follows the document pane independently of page or chat scrolling', async () => {
 localStorage.setItem('qiaomuWriteOutline', 'open');
 const ed = make('# First\n\n## Second');
 const layout = document.createElement('div'); layout.className = 'qw-layout';
 const pane = document.createElement('main'); pane.className = 'qw-scroll';
 const aside = document.createElement('aside'); layout.append(pane, aside); document.body.append(layout);
 const headings = headingsOf(ed); let moved = false;
 headings.forEach((item, i) => vi.spyOn(ed.view.nodeDOM(item.pos) as HTMLElement, 'getBoundingClientRect').mockImplementation(() => ({top: moved ? i * 50 : 100 + i * 200} as DOMRect)));
 const rail = mountOutline(aside, () => ed, () => 'Article'); rail.refresh();
 await new Promise(r => setTimeout(r, 260));
 expect(aside.querySelector('.active')?.textContent).toBe('First');
 moved = true; pane.dispatchEvent(new Event('scroll'));
 await new Promise(r => setTimeout(r, 40));
 expect(aside.querySelector('.active')?.textContent).toBe('Second'); rail.destroy(); vi.restoreAllMocks();
});
