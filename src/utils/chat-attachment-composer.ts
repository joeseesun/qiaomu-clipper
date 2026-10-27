import { createElement, ImagePlus } from 'lucide';
import { CHAT_IMAGE_TYPES, MAX_CHAT_ATTACHMENTS, prepareChatAttachment, type ChatAttachment } from './chat-attachments';
import { validChatTurns, type ChatImage } from './chat-content';
import { t } from './ui-text';

export function previewChatAttachment(name: string, images: ChatImage[]): void {
	const dialog = document.createElement('dialog'); dialog.className = 'clip-chat-attachment-preview';
	dialog.setAttribute('aria-label', name);
	const close = document.createElement('button'); close.type = 'button'; close.textContent = t('关闭');
	close.onclick = () => dialog.close();
	dialog.append(close);
	for (const part of images) {
		const image = document.createElement('img'); image.src = part.dataUrl; image.alt = part.label; dialog.append(image);
	}
	dialog.addEventListener('close', () => dialog.remove(), { once: true });
	document.body.append(dialog); dialog.showModal();
}

export function mountChatAttachmentComposer(options: { panel: HTMLElement; input: HTMLTextAreaElement; status: HTMLElement; busy: () => boolean }) {
	const lifetime = new AbortController();
	let decoding = new AbortController(), queue = Promise.resolve(), generation = 0, pending = 0;
	let drafts: ChatAttachment[] = [];
	let failures: Array<{ name: string; error: string }> = [];
	const list = document.createElement('div'); list.className = 'clip-chat-attachments'; list.hidden = true;
	const button = document.createElement('button'); button.type = 'button'; button.className = 'clip-chat-icon clip-chat-attach';
	button.title = t('添加图片（可粘贴或拖入）'); button.setAttribute('aria-label', button.title); button.append(createElement(ImagePlus));
	const picker = document.createElement('input'); picker.type = 'file'; picker.accept = CHAT_IMAGE_TYPES; picker.multiple = true; picker.hidden = true;
	picker.className = 'clip-chat-file-input';
	const render = () => {
		list.replaceChildren(); list.hidden = !drafts.length && !pending && !failures.length;
		list.setAttribute('aria-busy', String(pending > 0));
		button.disabled = options.busy() || options.input.disabled;
		for (const item of drafts) {
			const card = document.createElement('div'); card.className = 'clip-chat-attachment'; card.title = item.name;
			const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'clip-chat-attachment-thumb';
			preview.setAttribute('aria-label', `${t('查看图片')} ${item.name}`);
			const image = document.createElement('img'); image.src = item.thumbnail; image.alt = item.name; preview.append(image);
			preview.onclick = () => previewChatAttachment(item.name, item.images);
			const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'clip-chat-attachment-remove'; remove.textContent = '×';
			remove.setAttribute('aria-label', t('移除附件 ') + item.name); remove.disabled = options.busy();
			remove.onclick = () => { drafts = drafts.filter(draft => draft.id !== item.id); render(); };
			card.append(preview, remove); list.append(card);
		}
		for (const failure of failures) {
			const card = document.createElement('div'); card.className = 'clip-chat-attachment-error'; card.textContent = `${failure.name}: ${failure.error}`;
			const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', t('移除附件 ') + failure.name);
			remove.onclick = () => { failures = failures.filter(item => item !== failure); if (!failures.length) options.status.textContent = ''; render(); };
			card.append(remove); list.append(card);
		}
		if (pending) { const reading = document.createElement('span'); reading.textContent = t('正在读取图片…'); list.append(reading); }
	};
	const add = (files: File[]) => {
		if (lifetime.signal.aborted || !files.length) return;
		if (options.busy()) { options.status.textContent = t('请等当前回复结束后再添加图片。'); return; }
		options.status.textContent = '';
		for (const file of files) {
			if (drafts.length + pending + failures.length >= MAX_CHAT_ATTACHMENTS) { options.status.textContent = t('最多附加 {0} 项', [MAX_CHAT_ATTACHMENTS]); failures.push({ name: file.name, error: options.status.textContent }); break; }
			const activeGeneration = generation, signal = decoding.signal; pending++;
			queue = queue.then(async () => {
				if (activeGeneration !== generation || signal.aborted) return;
				try {
					const item = await prepareChatAttachment(file, signal);
					if (activeGeneration !== generation || signal.aborted) return;
					if (!validChatTurns([{ role: 'user', content: '', images: [...drafts.flatMap(draft => draft.images), ...item.images] }])) throw new Error(t('图片数量或大小超出限制，请减少所选图片后重试。'));
					drafts.push(item);
				} catch (error) { if (activeGeneration === generation && !signal.aborted) { failures.push({ name: file.name, error: String((error as Error).message) }); options.status.textContent = `${file.name}: ${String((error as Error).message)}`; } }
				finally { if (activeGeneration === generation) { pending--; render(); } }
			});
		}
		render();
	};
	button.onclick = () => picker.click();
	picker.addEventListener('change', () => { add(Array.from(picker.files || [])); picker.value = ''; }, { signal: lifetime.signal });
	options.input.addEventListener('paste', event => {
		const files = Array.from(event.clipboardData?.files || []);
		if (!files.length) return;
		event.preventDefault(); add(files);
		// A clipboard can contain both an image and text. Preserve the text at
		// the caret instead of discarding it when handling the image ourselves.
		const text = event.clipboardData?.getData('text/plain');
		if (text) { options.input.setRangeText(text, options.input.selectionStart, options.input.selectionEnd, 'end'); options.input.dispatchEvent(new Event('input', { bubbles: true })); }
	}, { signal: lifetime.signal });
	options.panel.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }, { signal: lifetime.signal });
	options.panel.addEventListener('drop', event => {
		if (!event.dataTransfer?.files.length) return;
		event.preventDefault(); add(Array.from(event.dataTransfer.files));
	}, { signal: lifetime.signal });
	const clear = () => { generation++; decoding.abort(); decoding = new AbortController(); queue = Promise.resolve(); pending = 0; drafts = []; failures = []; render(); };
	return {
		list, button, picker, refresh: render,
		hasImages: () => drafts.length + pending + failures.length > 0,
		hasErrors: () => failures.length > 0,
		peek: () => [...drafts],
		ready: () => queue,
		take: () => { const sent = drafts; drafts = []; render(); return sent; },
		// A retry owns fresh IDs, so asynchronous cleanup of the failed turn
		// cannot delete attachments being saved by the next request.
		restore: (items: ChatAttachment[]) => { drafts = [...items.map(item => ({ ...item, id: `chat-image-${crypto.randomUUID()}` })), ...drafts]; render(); },
		clear,
		destroy: () => { clear(); lifetime.abort(); }
	};
}
