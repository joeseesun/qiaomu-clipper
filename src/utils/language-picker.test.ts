// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLanguagePicker } from './language-picker';

const options = [
	{ code: 'zh-CN', label: '简体中文' },
	{ code: 'en', label: 'English' },
	{ code: 'ja', label: '日本語' },
] as const;

describe('createLanguagePicker', () => {
	beforeEach(() => { document.body.replaceChildren(); });

	it('keeps the Reader selector classes and native value bridge', () => {
		const picker = createLanguagePicker(document, { options, value: 'en' });
		document.body.append(picker.element);

		expect(picker.element.matches('.youtube-translation-picker')).toBe(true);
		expect(picker.select.matches('.youtube-translation-target')).toBe(true);
		expect(picker.button.matches('.youtube-translation-picker-trigger')).toBe(true);
		expect(picker.menu.matches('.youtube-translation-picker-menu')).toBe(true);
		expect(picker.options.get('en')?.matches('.youtube-translation-picker-option')).toBe(true);
		expect(picker.select.value).toBe('en');
		expect(picker.button.textContent).toBe('English');
		expect(picker.options.get('en')?.getAttribute('aria-selected')).toBe('true');
		expect(picker.options.get('en')?.tabIndex).toBe(0);
	});

	it('supports click, keyboard navigation, change events and outside close', () => {
		const picker = createLanguagePicker(document, { options });
		document.body.append(picker.element);
		const changed = vi.fn();
		picker.select.addEventListener('change', changed);

		picker.button.click();
		expect(picker.menu.hidden).toBe(false);
		expect(picker.button.getAttribute('aria-expanded')).toBe('true');
		picker.options.get('zh-CN')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(document.activeElement).toBe(picker.options.get('ja'));
		picker.options.get('ja')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(picker.select.value).toBe('ja');
		expect(changed).toHaveBeenCalledTimes(1);
		expect(picker.menu.hidden).toBe(true);

		picker.open();
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		expect(picker.menu.hidden).toBe(true);
	});

	it('rejects unknown values and restores focus after Escape', () => {
		const picker = createLanguagePicker(document, { options, value: 'missing' });
		document.body.append(picker.element);
		expect(picker.select.value).toBe('zh-CN');
		picker.choose('missing');
		expect(picker.select.value).toBe('zh-CN');
		picker.button.focus();
		picker.open(true);
		picker.options.get('zh-CN')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(picker.menu.hidden).toBe(true);
		expect(document.activeElement).toBe(picker.button);
	});
});
