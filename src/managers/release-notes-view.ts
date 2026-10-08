import { latestReleaseNotes } from '../utils/update-check';
import { uiLanguage } from '../utils/ui-text';

import { t } from '../utils/ui-text';
// "Recent updates" on the About page: what the newest published release says, as plain text.
export async function releaseNotesView(): Promise<void> {
	const group = document.getElementById('release-notes'), body = document.getElementById('release-notes-body'), title = document.getElementById('release-notes-title');
	if (!group || !body) return;
	const notes = await latestReleaseNotes();
	if (!notes) return;
	// The notes are written in Chinese: a reader of another language gets the link to the release page instead of text they can't read.
	const text = notes.lines.map(line => line.text).join('');
	if (uiLanguage() === 'en' && (text.match(/[\u4e00-\u9fff]/g) || []).length > text.length * 0.2) return;
	if (title) title.textContent = t('最近更新 · {0}{1}', [notes.version, notes.date ? ` · ${notes.date}` : '']);
	const list = document.createElement('ul');
	list.className = 'release-notes';
	for (const line of notes.lines) {
		const item = document.createElement('li');
		item.className = `release-${line.kind}`;
		item.textContent = line.text;
		list.appendChild(item);
	}
	body.replaceChildren(list);
	group.hidden = false;
}
