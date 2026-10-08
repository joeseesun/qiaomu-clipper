import { t } from './ui-text';
// Chrome words its native-messaging failures differently per cause; mapping them gives the user one concrete next step instead of a generic "not connected".
export function describeHelperFailure(reason?: string): string {
	const text = (reason || '').toLowerCase();
	if (text.includes('not found')) return t('本地保存助手还没安装（浏览器里找不到它）。');
	if (text.includes('forbidden')) return t('本地保存助手已安装，但尚未允许当前扩展 ID。请到「剪藏与保存」复制修复提示，让 Agent 注册当前扩展。');
	if (text.includes('exited')) return t('本地保存助手已安装但启动失败。请到「剪藏与保存」检查连接，或更新助手后重试。');
	return t('本地保存助手未连接，需要安装或更新。');
}

export function nativeHelperRepairPrompt(extensionId: string, reason?: string): string {
	return [
		t('请帮我修复「乔木剪藏」浏览器扩展的「本地保存助手未连接」问题。你需要能在我的电脑上运行终端命令。'),
		...(reason ? [t('浏览器返回的原始错误：{0}', [reason])] : []),
		t('1. 先阅读 https://github.com/joeseesun/qiaomu-clipper 的 README。macOS 优先下载并安装最新发布页的 qiaomu-clipper-helper.pkg；安装时需要我操作系统授权的话，请提醒我完成。'),
		t('2. macOS 安装包版使用 /Library/QiaomuClipper/bin/qiaomu-helper --check 诊断，并用 /Library/QiaomuClipper/bin/qiaomu-helper --extension-id {0} 注册当前扩展。其他系统或源码安装按 README 操作，在仓库目录运行 python3 native/install.py --extension-id {0}；Windows 可用 python 或 py -3。', [extensionId]),
		t('3. 不要编造扩展 ID 或 Obsidian 库路径。多个库时先让我选择；诊断失败时读取 error、hint 和 problems 处理。用当前安装方式对应的 --check 命令确认 "ok": true，再提醒我重新加载扩展并重试。')
	].join('\n');
}
