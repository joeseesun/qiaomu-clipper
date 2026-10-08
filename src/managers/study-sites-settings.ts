import { STUDY_SITES, cleanStudySites, isSiteOn, loadStudySites, saveStudySites, type StudySites } from '../utils/study-sites';
import { updateToggleState } from '../utils/ui-utils';

import { t } from '../utils/ui-text';
// "Supported sites" in the video settings: one switch per site, and one for every other address yt-dlp can read. All on by default.
export async function initializeStudySitesSettings(): Promise<void> {
	const list = document.getElementById('study-sites-list'); if (!list) return;
	let sites: StudySites = await loadStudySites(), pending: Promise<unknown> = Promise.resolve();
	const row = (id: string, name: string, note: string | undefined, on: boolean, change: (on: boolean) => void) => {
		const item = document.createElement('div'); item.className = 'setting-item mod-horizontal mod-toggle'; item.dataset.site = id;
		const info = document.createElement('div'); info.className = 'setting-item-info'; const label = document.createElement('label'); label.textContent = name; label.htmlFor = `study-site-${id}`; info.append(label);
		if (note) { const hint = document.createElement('div'); hint.className = 'setting-item-description'; hint.textContent = note; info.append(hint); }
		const control = document.createElement('div'); control.className = 'setting-item-control'; const holder = document.createElement('div'); holder.className = 'checkbox-container';
		const input = document.createElement('input'); input.type = 'checkbox'; input.id = `study-site-${id}`; input.checked = on; holder.append(input); control.append(holder); item.append(info, control);
		updateToggleState(holder, input);
		input.addEventListener('change', () => { updateToggleState(holder, input); change(input.checked); });
		return item;
	};
	// One save at a time, in order: two quick changes must not overwrite each other.
	const save = (next: StudySites) => { sites = cleanStudySites(next); pending = pending.then(() => saveStudySites(sites)); };
	const paint = () => {
		list.replaceChildren(
			...STUDY_SITES.map(site => row(site.id, site.name, site.note ?? t('媒体详情页字幕条、沉浸学习；读取取决于网站和登录状态'), isSiteOn(sites, site.id), on => save({ ...sites, off: on ? sites.off.filter(id => id !== site.id) : [...sites.off, site.id] }))),
			row('other', t('其他网站'), t('粘贴任何其他网站的链接时，可以选择按音视频学习（用 yt-dlp 试着读取，不保证每个网站都行）'), sites.other, on => save({ ...sites, other: on })),
		);
	};
	paint();
}
