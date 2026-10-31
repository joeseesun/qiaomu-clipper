import { loadSettings } from '../utils/storage-utils';
import { initializeI18n } from '../utils/i18n';
import { mountImageLibrary } from '../utils/image-library';
import { t } from '../utils/ui-text';
async function start() {
	await loadSettings(); await initializeI18n();
	document.title = t('图库');
	const root = document.getElementById('image-library')!;
	const dispose = mountImageLibrary(root, { initialTab: new URLSearchParams(location.search).get('tab') || location.hash.slice(1), initialQuery: new URLSearchParams(location.search).get('q') || '' });
	window.addEventListener('pagehide', dispose, { once: true });
}
void start();
