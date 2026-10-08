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
	'not-installed': '还没安装本地助手，无法确认今日日记位置',
	'not-allowed': '本地助手没有认出这个扩展，需要重新安装一次',
	'not-running': '本地助手无法启动，需要重新安装一次',
	'outdated': '本地助手版本太旧，需要更新一次',
	unknown: '本地助手未连接，无法确认今日日记位置'
})[problem];

export function helperInstallPrompt(extensionId: string): string {
	return [
		'帮我安装乔木剪藏的本地助手（让扩展能把笔记写进 Obsidian 日记）。',
		'',
		`1. 获取代码：没有就 git clone ${HELPER_REPO} ，已有就 git pull，然后进入仓库目录。`,
		`2. 运行 python3 native/install.py --extension-id ${extensionId}（Windows 用 python native\\install.py）。扩展 ID 已经给你了，不要自己找或猜；Obsidian 库路径也不要编造。`,
		'3. 输出里 "ok": false 时，读 error 和 hint 照做。如果找到多个 Obsidian 库，把名字列给我，问我用哪个，再加 --vault 重新运行。',
		'4. 成功后运行 python3 native/install.py --check，要看到 "ok": true。',
		'5. 最后告诉我：打开 chrome://extensions，点「乔木剪藏」的重新加载，再回到笔记里点「重试」。'
	].join('\n');
}
