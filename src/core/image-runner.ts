import browser from '../utils/browser-polyfill';
import { ImageJobRunner, type ImageWork } from '../utils/image-job-runner';
import { setUiLanguage } from '../utils/ui-text';
const runner = new ImageJobRunner(id => { void browser.runtime.sendMessage({ action: 'imageJobChanged', id }).catch(() => {}); });
browser.runtime.onMessage.addListener((request: any, sender) => {
	if (request?.target !== 'image-runner' || sender.id !== browser.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(browser.runtime.getURL('')))) return;
	return (async () => {
		try {
			if (request.language) setUiLanguage(request.language);
			if (request.action === 'enqueue') await runner.enqueue(request.work as ImageWork);
			else if (request.action === 'cancel') await runner.cancel(request.id);
			else await runner.initialize();
			return { ok: true };
		} catch (error) { return { ok: false, error: String((error as Error).message || error) }; }
	})();
});
