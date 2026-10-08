import { t } from './ui-text';
// Chrome words its native-messaging failures differently per cause; mapping them gives the user one concrete next step instead of a generic "not connected".
export function describeHelperFailure(reason?: string): string {
	const text = (reason || '').toLowerCase();
	if (text.includes('not found')) return t('本地保存助手还没安装（浏览器里找不到它）。');
	if (text.includes('forbidden')) return t('本地保存助手已安装，但不认这个扩展（商店版和本地加载版的扩展 ID 不同），需要重新运行安装（装过安装包的，在终端运行 /Library/QiaomuClipper/bin/qiaomu-helper）。');
	if (text.includes('exited')) return t('本地保存助手已安装但启动失败，常见原因是 Python 被卸载或移动，需要重新运行安装（装过安装包的，在终端运行 /Library/QiaomuClipper/bin/qiaomu-helper）。');
	return t('本地保存助手未连接，需要安装或更新。');
}

export function nativeHelperRepairPrompt(extensionId: string, reason?: string): string {
	return [
		t('请帮我修复「乔木剪藏」浏览器扩展的「本地保存助手未连接」问题。你需要能在我的电脑上运行终端命令。'),
		...(reason ? [t('浏览器返回的原始错误：{0}', [reason])] : []),
		t('0. 如果这台 Mac 上装过「乔木剪藏本地助手」安装包（存在 /Library/QiaomuClipper），不需要克隆仓库：直接运行 /Library/QiaomuClipper/bin/qiaomu-helper --check 诊断，再运行 /Library/QiaomuClipper/bin/qiaomu-helper --extension-id ')+extensionId+t(' 修复，然后跳到第 5 步。'),
		t('1. 若本机还没有仓库，先克隆：git clone https://github.com/joeseesun/qiaomu-clipper ，然后进入仓库目录。'),
		t('2. 先运行 python3 native/install.py --check 诊断，把输出里的 problems 告诉我；再运行 python3 native/install.py 安装或修复（无需参数，会自动识别扩展和 Obsidian 库）。需要 Python 3.9 或更新版本。Windows 上如果没有 python3 命令，改用 python 或 py -3。'),
		t('3. 输出 JSON 里 "ok": true 才算成功；"ok": false 时按 error 和 hint 处理。如果列出了多个 Obsidian 库，请先问我用哪个，再加 --vault 绝对路径重新运行。'),
		t('4. 如果找不到扩展，用 --extension-id {0} 手动指定（这是我当前扩展的 ID），不要自己编造 ID。', [extensionId]),
		t('5. 成功后再运行一次 python3 native/install.py --check 确认，并告诉我去 chrome://extensions 重新加载「乔木剪藏」，不需要重启浏览器。')
	].join('\n');
}
