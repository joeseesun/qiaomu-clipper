import browser from './browser-polyfill';
import { callHelper } from './native-helper-call';
import { xArticleUrl } from './x-article';

const actions = new Set(['xArticleStatus', 'xArticleStart', 'xArticlePoll', 'xArticleRead', 'xArticleCancel', 'xSetupStatus', 'xSetupStart', 'xSetupPoll', 'xSetupCancel']);
export function handleXArticle(request: any, sender: browser.Runtime.MessageSender): Promise<unknown> | undefined {
	if (!actions.has(request?.action)) return;
	return (async () => {
		try {
			if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')) || sender.tab?.incognito) throw new Error('invalid-x-request');
			const { action, id, offset } = request;
			if (!['xArticleStatus', 'xSetupStatus'].includes(action) && (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))) throw new Error('invalid-x-request');
			if (action === 'xSetupStart') {
				if (!['install', 'login'].includes(request.operation)) throw new Error('invalid-x-request');
				return await callHelper({ action, id, operation: request.operation }, false);
			}
			const url = action === 'xArticleStart' ? xArticleUrl(request.url) : undefined;
			if (action === 'xArticleStart' && !url) throw new Error('invalid-x-url');
			if (action === 'xArticleRead' && (!Number.isSafeInteger(offset) || offset < 0 || offset > 500_000)) throw new Error('invalid-x-request');
			// No caller-supplied prompts, commands, executable paths, credentials or file paths.
			return await callHelper({ action, id, url, offset }, false);
		} catch (error) { return { ok: false, error: String((error as Error).message || error) }; }
	})();
}
