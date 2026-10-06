export interface LanguagePickerOption {
	code: string;
	label: string;
}

export interface LanguagePicker {
	element: HTMLSpanElement;
	select: HTMLSelectElement;
	button: HTMLButtonElement;
	menu: HTMLSpanElement;
	options: Map<string, HTMLButtonElement>;
	open: (focusSelected?: boolean) => void;
	close: (restoreFocus?: boolean) => void;
	choose: (code: string) => void;
	sync: () => void;
	destroy: () => void;
}

export interface CreateLanguagePickerOptions {
	options: readonly LanguagePickerOption[];
	value?: string;
	ariaLabel?: string;
}

/**
 * Builds the compact language picker used by Reader transcript controls.
 *
 * The native select remains in the DOM as the compatibility/value bridge. The
 * visible button and listbox provide the same small reading-surface control to
 * any transcript feature (including browser-local transcription) without
 * duplicating its keyboard and outside-click behavior.
 */
export function createLanguagePicker(doc: Document, settings: CreateLanguagePickerOptions): LanguagePicker {
	const picker = doc.createElement('span');
	picker.className = 'youtube-translation-picker';
	const select = doc.createElement('select');
	select.className = 'youtube-translation-target';
	select.setAttribute('aria-label', settings.ariaLabel || 'Translation target language');
	select.setAttribute('aria-hidden', 'true');
	for (const item of settings.options) {
		const option = doc.createElement('option');
		option.value = item.code;
		option.textContent = item.label;
		select.append(option);
	}

	const button = doc.createElement('button');
	button.type = 'button';
	button.className = 'youtube-translation-picker-trigger';
	button.setAttribute('aria-haspopup', 'listbox');
	button.setAttribute('aria-expanded', 'false');
	const value = doc.createElement('span');
	value.className = 'youtube-translation-picker-value';
	button.append(value);

	const menu = doc.createElement('span');
	menu.className = 'youtube-translation-picker-menu';
	menu.setAttribute('role', 'listbox');
	menu.hidden = true;
	const optionButtons = new Map<string, HTMLButtonElement>();
	for (const item of settings.options) {
		const option = doc.createElement('button');
		option.type = 'button';
		option.className = 'youtube-translation-picker-option';
		option.dataset.value = item.code;
		option.textContent = item.label;
		option.setAttribute('role', 'option');
		option.tabIndex = -1;
		optionButtons.set(item.code, option);
		menu.append(option);
	}
	picker.append(select, button, menu);

	const sync = () => {
		const selected = settings.options.find(item => item.code === select.value) || settings.options[0];
		if (!selected) {
			value.textContent = '';
			button.removeAttribute('aria-label');
			return;
		}
		// Keep an invalid/empty native value from leaving the visible control out of sync.
		if (select.value !== selected.code) select.value = selected.code;
		value.textContent = selected.label;
		button.setAttribute('aria-label', `${settings.ariaLabel || 'Translation target language'}: ${selected.label}`);
		for (const [code, option] of optionButtons) {
			const active = code === selected.code;
			option.setAttribute('aria-selected', String(active));
			option.tabIndex = active ? 0 : -1;
			option.classList.toggle('is-selected', active);
		}
	};
	const close = (restoreFocus = false) => {
		picker.classList.remove('is-open');
		menu.hidden = true;
		button.setAttribute('aria-expanded', 'false');
		if (restoreFocus) button.focus();
	};
	const open = (focusSelected = false) => {
		picker.classList.add('is-open');
		menu.hidden = false;
		button.setAttribute('aria-expanded', 'true');
		if (focusSelected) optionButtons.get(select.value)?.focus();
	};
	const choose = (code: string) => {
		if (!optionButtons.has(code)) return;
		const changed = select.value !== code;
		select.value = code;
		sync();
		close();
		if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const onButtonClick = () => menu.hidden ? open() : close();
	const onButtonKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
			event.preventDefault();
			open(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	};
	const optionHandlers = new Map<HTMLButtonElement, { click: () => void; keydown: (event: KeyboardEvent) => void }>();
	for (const option of optionButtons.values()) {
		const onClick = () => choose(option.dataset.value || '');
		const onKeydown = (event: KeyboardEvent) => {
			const items = Array.from(optionButtons.values());
			const index = items.indexOf(option);
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
			} else if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				choose(option.dataset.value || '');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				close(true);
			}
		};
		option.addEventListener('click', onClick);
		option.addEventListener('keydown', onKeydown);
		optionHandlers.set(option, { click: onClick, keydown: onKeydown });
	}
	const onPointerDown = (event: PointerEvent) => {
		if (!picker.contains(event.target as Node)) close();
	};
	button.addEventListener('click', onButtonClick);
	button.addEventListener('keydown', onButtonKeydown);
	doc.addEventListener('pointerdown', onPointerDown);
	select.value = settings.value || settings.options[0]?.code || '';
	sync();

	return {
		element: picker,
		select,
		button,
		menu,
		options: optionButtons,
		open,
		close,
		choose,
		sync,
		destroy: () => {
			button.removeEventListener('click', onButtonClick);
			button.removeEventListener('keydown', onButtonKeydown);
			doc.removeEventListener('pointerdown', onPointerDown);
			for (const [option, handlers] of optionHandlers) {
				option.removeEventListener('click', handlers.click);
				option.removeEventListener('keydown', handlers.keydown);
			}
		},
	};
}
