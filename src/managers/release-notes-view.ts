import { latestReleaseNotes } from '../utils/update-check';

// "Recent updates" on the About page: what the newest published release says, as plain text.
export async function releaseNotesView(): Promise<void> {
	const group = document.getElementById('release-notes'), body = document.getElementById('release-notes-body'), title = document.getElementById('release-notes-title');
	if (!group || !body) return;
	const notes = await latestReleaseNotes();
	if (!notes) return;
	if (title) title.textContent = `最近更新 · ${notes.version}${notes.date ? ` · ${notes.date}` : ''}`;
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
