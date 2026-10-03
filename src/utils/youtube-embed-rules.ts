// Extension pages do not have sender.tab. Identify their iframe requests by
// extension ID instead; keep page-reader rules separate for each source tab.
const EXTENSION_RULE_ID = 9003;
const TAB_RULE_BASE = 10000;

export function createYouTubeEmbedRules(extensionId: string, tabId?: number): chrome.declarativeNetRequest.Rule[] {
	const action: chrome.declarativeNetRequest.RuleAction = {
		type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
		requestHeaders: [{
			header: 'Referer',
			operation: chrome.declarativeNetRequest.HeaderOperation.SET,
			value: `https://qiaomu-clipper.${extensionId}/`,
		}],
	};
	const condition: chrome.declarativeNetRequest.RuleCondition = {
		urlFilter: '||youtube.com/embed/',
		resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
	};
	const rules: chrome.declarativeNetRequest.Rule[] = [{
		id: EXTENSION_RULE_ID, priority: 1, action,
		condition: { ...condition, initiatorDomains: [extensionId] },
	}];
	if (tabId !== undefined && Number.isInteger(tabId) && tabId >= 0) {
		rules.push({ id: TAB_RULE_BASE + tabId, priority: 1, action, condition: { ...condition, tabIds: [tabId] } });
	}
	return rules;
}

let extensionRuleReady: Promise<void> | undefined;
export async function enableYouTubeEmbedRule(tabId?: number): Promise<void> {
	if (!chrome.declarativeNetRequest) return;
	if (!extensionRuleReady) {
		const [rule] = createYouTubeEmbedRules(chrome.runtime.id);
		extensionRuleReady = chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id, 9001], addRules: [rule] })
			.catch(error => { extensionRuleReady = undefined; throw error; });
	}
	await extensionRuleReady;
	const rule = createYouTubeEmbedRules(chrome.runtime.id, tabId)[1];
	if (rule) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
}

export async function disableYouTubeEmbedRule(tabId?: number): Promise<void> {
	if (!chrome.declarativeNetRequest || tabId === undefined || !Number.isInteger(tabId) || tabId < 0) return;
	await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [TAB_RULE_BASE + tabId] });
}
