import browser from './browser-polyfill';
import { loadSettings, oauthStore, getLocalStorage } from './storage-utils';
import { freshOAuth } from './oauth/accounts';
import { ASPECTS, loadImageModels, readyModels, modelsOf, labelOf, providerOf } from '../write/image-models';
import { callHelper } from './native-helper-call';
import type { ImageJob } from './image-library-store';
import { t } from './ui-text';

let creating: Promise<void> | undefined;
export async function ensureImageRunner(): Promise<void> {
	if (creating) return creating;
	creating = (async () => {
		const offscreen = typeof chrome !== 'undefined' ? (chrome as any).offscreen : undefined;
		const url = browser.runtime.getURL('image-runner.html');
		if (offscreen) {
			const contexts = await (chrome.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
			if (!contexts.length) await offscreen.createDocument({ url: 'image-runner.html', reasons: ['BLOBS'], justification: 'Generate, decode and store image blobs independently of the chat sidebar.' });
		} else if (typeof document !== 'undefined') {
			if (!document.querySelector('iframe[data-image-runner]')) await new Promise<void>((resolve, reject) => {
				const frame = document.createElement('iframe'); frame.hidden = true; frame.dataset.imageRunner = ''; frame.src = url;
				frame.onload = () => resolve(); frame.onerror = () => { frame.remove(); reject(new Error('image-job-unavailable')); }; document.body.append(frame);
			});
		} else throw new Error('image-job-unavailable');
		const reply = await browser.runtime.sendMessage({ target: 'image-runner', action: 'initialize' }) as { ok?: boolean; error?: string };
		if (!reply?.ok) throw new Error(reply?.error || 'image-job-unavailable');
	})().finally(() => { creating = undefined; });
	return creating;
}
const ownPage = (sender: browser.Runtime.MessageSender) => sender.id === browser.runtime.id && !!sender.url?.startsWith(browser.runtime.getURL(''));
export function handleImageJobs(request: any, sender: browser.Runtime.MessageSender): Promise<unknown> | undefined {
	if (!['imageJobSubmit', 'imageJobCancel', 'imageJobEnsure', 'codexImageStatus', 'codexImageStart', 'codexImagePoll', 'codexImageRead', 'codexImageCancel'].includes(request?.action)) return;
	return (async () => {
		try {
			if (!ownPage(sender) || sender.tab?.incognito) throw new Error('invalid-image-request');
			if (request.action.startsWith('codexImage')) {
				// Explicit allowlist: no executable paths, shell arguments or arbitrary file reads.
				const { action, id, prompt, model, offset } = request;
				return await callHelper({ action, id, prompt, model, offset });
			}
			await ensureImageRunner();
			if (request.action === 'imageJobEnsure') return { ok: true };
			if (typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(request.id)) throw new Error('invalid-image-request');
			if (request.action === 'imageJobCancel') return await browser.runtime.sendMessage({ target: 'image-runner', action: 'cancel', id: request.id });
			if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 16000 || !ASPECTS.includes(request.aspect)) throw new Error('invalid-image-request');
			await loadSettings();
			const config = readyModels(await loadImageModels()).find(c => c.id === request.configId && modelsOf(c).includes(request.modelId));
			if (!config) throw new Error('not-ready');
			const provider = config.engine === 'oauth' ? providerOf(config) : undefined;
			if (provider?.oauth) await freshOAuth(provider, oauthStore);
			const job: ImageJob = { id: request.id, prompt: request.prompt.trim(), aspect: request.aspect, configId: config.id, modelId: request.modelId, modelLabel: labelOf(config, request.modelId), created: Date.now(), state: 'queued', ...(config.engine === 'codex' ? { engine: 'codex' as const } : {}) };
			return await browser.runtime.sendMessage({ target: 'image-runner', action: 'enqueue', work: { job, config, provider }, language: await getLocalStorage('language') });
		} catch (error) { return { ok: false, error: String((error as Error)?.message || t('生成失败')) }; }
	})();
}
