import { loadClipPreview, updateClipPreview, ClipPreview } from '../utils/clip-preview';
import { createClipBar, autoHideBar } from '../utils/clip-bar';
import { mountClipChat } from '../utils/clip-chat';
import { generateFrontmatter } from '../utils/obsidian-note-creator';
import { sanitizeFileName } from '../utils/string-utils';
import { translatePage } from '../utils/i18n';
import { generalSettings, loadSettings } from '../utils/storage-utils';
import type { Property } from '../types/types';
import { mountEditorOutline } from '../utils/editor-outline';
import { mountLocalPreviewMedia, preserveLocalPreviewMedia } from '../utils/local-preview-media';

import { t } from '../utils/ui-text';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderProperties(properties: Property[]) {
	const container = byId<HTMLDivElement>('ce-properties');
	container.textContent = '';
	for (const property of properties) {
		const row = document.createElement('div');
		row.className = 'ce-property';
		const label = document.createElement('label');
		label.textContent = property.name;
		const input = document.createElement('input');
		input.id = `ce-prop-${property.name}`;
		input.dataset.name = property.name;
		input.dataset.id = String(property.id ?? '');
		label.htmlFor = input.id;
		if (typeof property.value === 'boolean') {
			input.type = 'checkbox';
			input.checked = property.value;
		} else {
			input.type = 'text';
			input.value = String(property.value ?? '');
		}
		row.append(label, input);
		container.appendChild(row);
	}
}

function readProperties(): Property[] {
	return Array.from(document.querySelectorAll<HTMLInputElement>('#ce-properties input')).map(input => ({
		id: input.dataset.id || Date.now().toString() + Math.random().toString(36).slice(2, 11),
		name: input.dataset.name!,
		value: input.type === 'checkbox' ? input.checked : input.value
	})) as Property[];
}

// Collect the edited fields back into the draft so every action (copy, download, clip, switching to reading) sees them.
async function syncDraft(draft: ClipPreview, title: HTMLInputElement) {
	const name = title.value.trim() || 'Untitled';
	const markdown = byId<HTMLTextAreaElement>('ce-markdown').value;
	const properties = readProperties();
	if (markdown !== draft.clip.markdown) draft.transcriptExport = undefined;
	draft.properties = properties;
	draft.clip.title = name;
	draft.clip.markdown = markdown;
	draft.local.name = `${sanitizeFileName(name)}.md`;
	draft.local.content = await generateFrontmatter(properties) + markdown;
	await updateClipPreview(draft);
	await preserveLocalPreviewMedia(draft);
}

document.addEventListener('DOMContentLoaded', async () => {
	await translatePage();
	await loadSettings();
	const id = new URLSearchParams(location.search).get('id') || '';
	const draft = await loadClipPreview(id);
	if (!draft) { document.body.textContent = t('剪藏草稿已过期，请从弹窗重新打开编辑'); return; }

	document.title = draft.clip.title;
	const title = document.createElement('input');
	title.type = 'text';
	title.autocomplete = 'off';
	title.value = draft.clip.title;
	byId<HTMLTextAreaElement>('ce-markdown').value = draft.clip.markdown;
	if (draft.properties?.length) renderProperties(draft.properties);
	else document.querySelector('.ce-props h2')?.setAttribute('hidden', '');

	const textarea = byId<HTMLTextAreaElement>('ce-markdown');
	await mountLocalPreviewMedia(draft, document.querySelector<HTMLElement>('.ce-body')!, textarea);
	mountEditorOutline(document.querySelector<HTMLElement>('.ce-props')!, textarea, !!draft.properties?.length);
	const chat = mountClipChat({
		getContext: () => ({ title: title.value || draft.clip.title, markdown: textarea.value, url: draft.clip.url }),
		onInsert: text => { textarea.value = `${textarea.value.trimEnd()}\n\n${text}\n`; textarea.dispatchEvent(new Event('input')); },
	});
	if (generalSettings.editorAutoChat) chat.toggle(true);
	const bar = createClipBar({ onToggleChat: chat.toggle, mode: 'edit', id, draft, title, domain: new URL(draft.clip.url).hostname.replace(/^www\./, ''), url: draft.clip.url, sync: () => syncDraft(draft, title) });
	document.body.prepend(bar);
	autoHideBar(bar, { collapseLayout: true });
});
