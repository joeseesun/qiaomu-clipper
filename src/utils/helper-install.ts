import { nativeHelperRepairPrompt } from './native-helper-prompt';
import { t } from './ui-text';
// The local helper is the one piece a person cannot install from the browser. When it is missing, say why in plain words and
// hand over a message an AI assistant can act on, with this browser's own extension ID so nobody has to find or guess it.
export const HELPER_REPO = 'https://github.com/joeseesun/qiaomu-clipper';
export type HelperProblem = 'not-installed' | 'not-allowed' | 'not-running' | 'outdated' | 'unknown';

// The helper reports its protocol number with the diary target. Helpers from before the number existed stay accepted; only a
// helper that names an older number than this one is asked to update.
export const MIN_HELPER_PROTOCOL = 2;
export const helperIsOutdated = (reported: unknown): boolean => typeof reported === 'number' && reported < MIN_HELPER_PROTOCOL;

// Chrome words these failures differently; anything else is "unknown" and still gets the same way out.
export function classifyHelperError(error: unknown): HelperProblem {
	const text = String((error as { message?: unknown } | undefined)?.message ?? error ?? '').toLowerCase();
	if (text.includes('not found')) return 'not-installed';
	if (text.includes('forbidden')) return 'not-allowed';
	if (text.includes('exited') || text.includes('communicating')) return 'not-running';
	return 'unknown';
}
export const helperProblemText = (problem: HelperProblem): string => ({
	'not-installed': t('还没安装本地助手，无法确认今日日记位置'),
	'not-allowed': t('本地助手没有认出这个扩展，需要重新安装一次'),
	'not-running': t('本地助手无法启动，需要重新安装一次'),
	'outdated': t('本地助手版本太旧，需要更新一次'),
	unknown: t('本地助手未连接，无法确认今日日记位置')
})[problem];

export function helperInstallPrompt(extensionId: string): string {
	return t('帮我安装乔木剪藏的本地助手（让扩展能把笔记写进 Obsidian 日记）。') + '\n' + nativeHelperRepairPrompt(extensionId);
}
