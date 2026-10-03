// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { listenTripleKey } from './utils/triple-key';

it('fires only for three quick plain presses outside text fields', () => {
	const onTriple = vi.fn();
	listenTripleKey(['q'], onTriple);
	const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
		target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }));

	press('q'); press('q');
	expect(onTriple).not.toHaveBeenCalled();
	press('q');
	expect(onTriple).toHaveBeenCalledWith('q');

	onTriple.mockClear();
	const input = document.body.appendChild(document.createElement('input'));
	press('q', input); press('q', input); press('q', input);
	press('q', document.body, { metaKey: true }); press('q', document.body, { metaKey: true }); press('q', document.body, { metaKey: true });
	press('q'); press('a'); press('q');
	expect(onTriple).not.toHaveBeenCalled();
});

import { normalizeTripleKeys, commandForKey, DEFAULT_TRIPLE_KEYS } from './utils/triple-key';

it('uses the defaults when nothing is configured', () => {
	expect(normalizeTripleKeys(undefined)).toEqual(DEFAULT_TRIPLE_KEYS);
});

it('keeps valid custom keys, lowercases them, and turns empty ones off', () => {
	const keys = normalizeTripleKeys({ read: 'R', edit: '', clip: '7' });
	expect(keys).toEqual({ read: 'r', edit: '', clip: '7' });
	expect(commandForKey(keys, 'r')).toBe('read');
	expect(commandForKey(keys, '7')).toBe('clip');
	expect(commandForKey(keys, 'e')).toBeUndefined();
});

it('drops invalid and duplicate keys instead of letting two actions share one', () => {
	expect(normalizeTripleKeys({ read: 'x', edit: 'x', clip: 'ab' })).toEqual({ read: 'x', edit: '', clip: '' });
});

it('listens to a key list that changes at runtime', () => {
	let keys = ['z'];
	const seen = vi.fn();
	listenTripleKey(() => keys, seen);
	const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	press('z'); press('z'); press('z');
	expect(seen).toHaveBeenCalledWith('z');
	seen.mockClear(); keys = ['y'];
	press('z'); press('z'); press('z');
	expect(seen).not.toHaveBeenCalled();
});

import { normalizeSite, normalizeSites, isSiteBlocked } from './utils/triple-key';

it('normalizes pasted sites and matches subdomains', () => {
	expect(normalizeSite('https://www.Mail.Google.com/mail/u/0')).toBe('mail.google.com');
	expect(normalizeSite('*.example.com')).toBe('example.com');
	expect(normalizeSite('not a site!')).toBe('');
	expect(normalizeSites(['a.com', 'https://a.com/x', '', 'b.org'])).toEqual(['a.com', 'b.org']);
	expect(isSiteBlocked('docs.example.com', ['example.com'])).toBe(true);
	expect(isSiteBlocked('example.com', ['example.com'])).toBe(true);
	expect(isSiteBlocked('notexample.com', ['example.com'])).toBe(false);
	expect(isSiteBlocked('www.a.com', undefined)).toBe(false);
});


it('ignores buttons in an open dialog and resets the partial sequence without blocking ordinary shortcuts', () => {
 const seen = vi.fn(); listenTripleKey(['a'], seen);
 const dialog = document.body.appendChild(document.createElement('dialog'));
 const button = dialog.appendChild(document.createElement('button'));
 const icon = button.appendChild(document.createElement('span'));
 const press = (target: EventTarget) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
 press(document.body); press(document.body);
 dialog.setAttribute('open', ''); press(icon); press(button); press(button);
 expect(seen).not.toHaveBeenCalled();
 dialog.removeAttribute('open'); press(document.body); expect(seen).not.toHaveBeenCalled();
 press(document.body); press(document.body); expect(seen).toHaveBeenCalledTimes(1);
 seen.mockClear(); press(button); press(button); press(button); expect(seen).toHaveBeenCalledTimes(1);
 dialog.remove();
});
