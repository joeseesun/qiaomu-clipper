import { beforeEach, expect, it, vi } from 'vitest';

const update = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
	vi.resetModules(); update.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal('chrome', {
		runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
		declarativeNetRequest: {
			updateSessionRules: update,
			RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
			HeaderOperation: { SET: 'set' },
			ResourceType: { SUB_FRAME: 'sub_frame' },
		},
	});
});

it('installs an extension-scoped Referer even when sender.tab is absent', async () => {
	const { enableYouTubeEmbedRule } = await import('./youtube-embed-rules');
	await enableYouTubeEmbedRule();
	const rule = update.mock.calls[0][0].addRules[0];
	expect(rule.condition).toEqual({
		urlFilter: '||youtube.com/embed/', resourceTypes: ['sub_frame'],
		initiatorDomains: [chrome.runtime.id],
	});
	expect(rule.condition.tabIds).toBeUndefined();
	expect(rule.action.requestHeaders).toEqual([{
		header: 'Referer', operation: 'set', value: `https://qiaomu-clipper.${chrome.runtime.id}/`,
	}]);
});

it('keeps concurrent readers independent and never removes the extension rule on exit', async () => {
	const { enableYouTubeEmbedRule, disableYouTubeEmbedRule } = await import('./youtube-embed-rules');
	await Promise.all([enableYouTubeEmbedRule(42), enableYouTubeEmbedRule(43), enableYouTubeEmbedRule()]);
	expect(update).toHaveBeenCalledTimes(3);
	const tabRules = update.mock.calls.slice(1).map(call => call[0].addRules[0]);
	expect(tabRules.map(rule => rule.id)).toEqual([10042, 10043]);
	expect(tabRules.map(rule => rule.condition.tabIds)).toEqual([[42], [43]]);
	await disableYouTubeEmbedRule();
	expect(update).toHaveBeenCalledTimes(3);
	await disableYouTubeEmbedRule(42);
	expect(update).toHaveBeenLastCalledWith({ removeRuleIds: [10042] });
});

it('propagates a failed installation and allows the next reader to retry', async () => {
	const { enableYouTubeEmbedRule } = await import('./youtube-embed-rules');
	update.mockRejectedValueOnce(new Error('Rule rejected'));
	await expect(enableYouTubeEmbedRule()).rejects.toThrow('Rule rejected');
	await enableYouTubeEmbedRule();
	expect(update).toHaveBeenCalledTimes(2);
});
