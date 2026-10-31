import { createElement, Ellipsis } from 'lucide';
import { t } from './ui-text';

// Kept in the shared bar so reading, study and editing have the same actions.
export function clipBarMenu(bar: HTMLElement) {
	const trigger = document.createElement('button');
	trigger.type = 'button'; trigger.id = 'clip-bar-more'; trigger.className = 'is-icon';
	trigger.title = t('更多'); trigger.setAttribute('aria-label', t('更多'));
	trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
	trigger.append(createElement(Ellipsis));
	const menu = document.createElement('div');
	menu.id = 'clip-bar-more-menu'; menu.className = 'clip-more-menu'; menu.hidden = true;
	menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('更多'));
	trigger.setAttribute('aria-controls', menu.id);
	const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled), input:not(:disabled)')).filter(el => !el.hidden);
	const position = () => {
		if (menu.hidden) return;
		const rect = trigger.getBoundingClientRect();
		menu.style.maxHeight = `${Math.max(0, window.innerHeight - rect.bottom - 16)}px`;
		menu.style.top = `${rect.bottom + 6}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
	};
	const close = (restore = false) => {
		menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
		delete bar.dataset.menuOpen;
		if (restore) trigger.focus({ preventScroll: true });
	};
	const open = (last = false) => {
		menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); bar.dataset.menuOpen = 'true';
		bar.classList.remove('is-hidden'); document.documentElement.classList.remove('clip-bar-hidden');
		position();
		const choices = items(); (last ? choices[choices.length - 1] : choices[0])?.focus({ preventScroll: true });
	};
	trigger.addEventListener('click', () => menu.hidden ? open() : close(true));
	trigger.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(event.key === 'ArrowUp'); }
	});
	const outside = (event: Event) => { if (!menu.hidden && !menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
	const keys = (event: KeyboardEvent) => {
		if (menu.hidden) return;
		if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
		if (!menu.contains(event.target as Node)) return;
		if (event.key === 'Tab') { close(true); return; }
		const choices = items(), current = choices.indexOf(document.activeElement as HTMLButtonElement);
		let next: number | undefined;
		if (event.key === 'ArrowDown') next = (current + 1) % choices.length;
		if (event.key === 'ArrowUp') next = (current - 1 + choices.length) % choices.length;
		if (event.key === 'Home') next = 0;
		if (event.key === 'End') next = choices.length - 1;
		if (next !== undefined) { event.preventDefault(); choices[next]?.focus(); }
	};
	document.addEventListener('pointerdown', outside, true);
	document.addEventListener('keydown', keys, true);
	window.addEventListener('resize', position);
	const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : undefined;
	observer?.observe(menu);
	window.addEventListener('pagehide', () => {
		observer?.disconnect(); document.removeEventListener('pointerdown', outside, true);
		document.removeEventListener('keydown', keys, true); window.removeEventListener('resize', position);
	}, { once: true });
	const add = (item: HTMLButtonElement) => {
		item.setAttribute('role', 'menuitem'); item.tabIndex = -1;
		item.addEventListener('click', () => close(true)); menu.append(item);
	};
	const divider = () => { const el = document.createElement('div'); el.className = 'clip-more-divider'; el.setAttribute('role', 'separator'); menu.append(el); };
	return { trigger, menu, add, divider, close };
}
