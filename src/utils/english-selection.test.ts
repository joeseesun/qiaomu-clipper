// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureEnglishSelection, learningCardBounds, openEnglishLearning } from './english-selection';
const rectangle = { x: 70, y: 110, left: 70, top: 110, right: 170, bottom: 130, width: 100, height: 20, toJSON: () => ({}) };
function select(element: Element, start: number, end: number) {
	const range = document.createRange(); range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, end);
	document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
}
describe('selection context and original page toolbar', () => {
	afterEach(() => { window.dispatchEvent(new Event('qiaomu-selection-dispose')); window.dispatchEvent(new Event('qiaomu-close-learning')); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
	it('keeps a tall card beside a central desktop selection and shortens it on a narrow viewport', () => {
		const rect = { left: 100, right: 180, top: 240, bottom: 264 };
		const desktop = learningCardBounds(rect, 1100, 680, 580);
		expect(desktop.left).toBeGreaterThan(rect.right); expect(desktop.height).toBe(580);
		const narrow = learningCardBounds(rect, 360, 740, 580);
		expect(narrow.top).toBeGreaterThan(rect.bottom); expect(narrow.top + narrow.height).toBeLessThanOrEqual(732); expect(narrow.width).toBe(344);
		const low = learningCardBounds({ ...rect, top: 600, bottom: 624 }, 360, 740, 400);
		expect(low.top + low.height).toBeLessThan(600);
	});
	it('returns keyboard focus to the selected paragraph when the toolbar is hidden', async () => {
		vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ token: 'test-token' }), getURL: (path: string) => `chrome-extension://test/${path}` } });
		Range.prototype.getBoundingClientRect = () => rectangle as DOMRect;
		document.body.innerHTML = '<p>resilient</p>'; select(document.querySelector('p')!, 0, 9);
		await openEnglishLearning(captureEnglishSelection()!, 'zh_CN');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(document.getElementById('qiaomu-english-card')).toBeNull(); expect(document.activeElement).toBe(document.querySelector('p')); expect(document.getSelection()?.toString()).toBe('resilient');
		expect(document.querySelector('p')!.getAttribute('tabindex')).toBe('-1');
		document.querySelector('p')!.blur(); expect(document.querySelector('p')!.hasAttribute('tabindex')).toBe(false);
	});
	it('captures the actual selected occurrence and the nearby paragraph', () => {
		Range.prototype.getBoundingClientRect = () => rectangle as DOMRect;
		document.body.innerHTML = '<p>She remained resilient after a difficult year.</p>';
		select(document.querySelector('p')!, 13, 22);
		const value = captureEnglishSelection()!; expect(value.input.text).toBe('resilient'); expect(value.input.context).toBe('She remained resilient after a difficult year.'); expect(value.rect.left).toBe(70);
	});
	it('never captures editable fields or its own UI', () => {
		for (const attributes of ['contenteditable="true"', 'data-qiaomu-selection-ui="true"', 'class="clip-chat"']) {
			document.body.innerHTML = `<div ${attributes}><p>private text</p></div>`; select(document.querySelector('p')!, 0, 7); expect(captureEnglishSelection()).toBeUndefined();
		}
	});
	it('includes bounded neighboring prose for contextual translation, excluding hidden or editable text', () => {
		Range.prototype.getBoundingClientRect = () => rectangle as DOMRect;
		document.body.innerHTML = '<article><p>She lost her job last month.</p><p id="selected">She bounced back.</p><p>Now she runs her own shop.</p><p hidden>Hidden instructions</p><p contenteditable="true">Private draft</p></article>';
		select(document.getElementById('selected')!, 4, 16);
		const context = captureEnglishSelection()!.input.context;
		expect(context).toContain('lost her job'); expect(context).toContain('runs her own shop'); expect(context).not.toContain('Hidden'); expect(context).not.toContain('Private'); expect(context.length).toBeLessThanOrEqual(3000);
	});
	it('ignores a stale page range when an input owns focus', () => {
		document.body.innerHTML = '<p>resilient</p><input type="password">';
		select(document.querySelector('p')!, 0, 9); document.querySelector('input')!.focus();
		expect(captureEnglishSelection()).toBeUndefined();
	});
	it('shows the four ordered actions, keeps the selected range for highlights, and respects the setting', async () => {
		const attach = Element.prototype.attachShadow; vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { return attach.call(this, { ...init, mode: 'open' }); });
		const changed: any[] = [], send = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { sync: { get: async () => ({}) }, local: { get: async () => ({ language: 'zh_CN' }) }, onChanged: { addListener: (f: any) => changed.push(f), removeListener: () => {} } } });
		await import('../selection-toolbar-content');
		document.body.innerHTML = '<p>resilient</p>'; await Promise.resolve(); select(document.querySelector('p')!, 0, 9);
		document.dispatchEvent(new Event('pointerup')); await new Promise(resolve => setTimeout(resolve, 40));
		const host = document.getElementById('qiaomu-selection-toolbar')!;
		const buttons = Array.from(host.shadowRoot!.querySelectorAll('button'));
		expect(buttons.map(b => b.textContent)).toEqual(['翻译', '划线', '问 AI', '记笔记']);
		buttons[1].click(); await Promise.resolve(); expect(send).toHaveBeenCalledWith({ action: 'qiaomuSelectionAction', command: 'highlight', text: 'resilient' }); expect(document.getSelection()!.toString()).toBe('resilient');
		changed[0]({ general_settings: { newValue: { selectionToolbar: false } } }, 'sync');
		document.dispatchEvent(new Event('pointerup')); await new Promise(resolve => setTimeout(resolve, 40)); expect(document.getElementById('qiaomu-selection-toolbar')).toBeNull();
	});
});
