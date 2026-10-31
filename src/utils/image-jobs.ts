import browser from './browser-polyfill';
import { type ImageJob } from './image-library-store';
import { t } from './ui-text';
export async function submitImageJob(request: Pick<ImageJob, 'id' | 'prompt' | 'aspect' | 'configId' | 'modelId'>): Promise<void> {
	const reply = await browser.runtime.sendMessage({ action: 'imageJobSubmit', ...request }) as { ok?: boolean; error?: string };
	if (!reply?.ok) throw new Error(reply?.error || 'image-job-unavailable');
}
export async function cancelImageJob(id: string): Promise<void> {
	const reply = await browser.runtime.sendMessage({ action: 'imageJobCancel', id }) as { ok?: boolean; error?: string };
	if (!reply?.ok) throw new Error(reply?.error || 'image-job-unavailable');
}
export function watchImageJobs(changed: () => void): () => void {
	const listener = (message: any) => { if (message?.action === 'imageJobChanged') changed(); return undefined; };
	browser.runtime.onMessage.addListener(listener);
	void browser.runtime.sendMessage({ action: 'imageJobEnsure' }).then(changed).catch(changed);
	return () => browser.runtime.onMessage.removeListener(listener);
}
export const imageJobLabel = (state: ImageJob['state']): string => ({
	queued: t('排队中'), running: t('后台生成中'), ready: t('已完成'), failed: t('生成失败'),
	cancelled: t('已取消'), interrupted: t('已中断，请手动重试'),
})[state];
export const openImageLibrary = (tab = 'images'): void => { void browser.tabs.create({ url: browser.runtime.getURL(`image-library.html#${tab}`) }); };
