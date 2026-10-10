import browser from '../utils/browser-polyfill';
import { showStudyHome } from '../utils/study-home';
import { putHandedFile } from '../utils/file-handoff';

// "Transcribe and study", the first page of the learning group in the settings: the menu stays beside it like every other page. A study itself
// opens in a tab of its own (it is a reading page, not a setting).
export async function initializeStudyHome(): Promise<void> {
	const root = document.getElementById('study-home'); if (!root) return;
	const openTab = (path: string) => { void browser.tabs.create({ url: browser.runtime.getURL(path) }); };
	const refresh = await showStudyHome(document, {
		open: openTab,
		// A chosen file is handed over through the extension's database; where that is not possible the study page asks for the file itself.
		openFile: file => { void putHandedFile(file).then(token => openTab(token ? `reader.html?study=file&token=${token}` : 'reader.html?study=file&token=unavailable')); },
	}, root);
	// What was studied since the page was drawn, and the sites switched on or off in the meantime.
	document.addEventListener('qiaomu-study-shown', () => { void refresh(); });
}
