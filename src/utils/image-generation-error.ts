import { describeHelperFailure } from './native-helper-prompt';
import { t } from './ui-text';

export function describeImageError(error: unknown): string {
	const text = String((error as Error)?.message ?? error);
	if (/native messaging|native host|host.*not found/i.test(text)) return describeHelperFailure(text);
	if (/codex-image-missing|codex-process-closed/.test(text)) return t('已中断，请手动重试');
	if (/codex-login-required/.test(text)) return t('请先在本机 Codex 登录 ChatGPT 账号。');
	if (/codex-missing/.test(text)) return t('未找到本机 Codex，请先安装并登录 Codex。');
	if (/codex-helper-unavailable|未知操作|不支持的操作/.test(text)) return t('请更新本地助手后重试。');
	if (/invalid-image/.test(text)) return t('图片无效或超过 20 MB，请换个模型重试。');
	if (/image-job-unavailable/.test(text)) return t('后台生图暂不可用，请重载扩展后重试。');
	if (text.startsWith('service-error:')) return t('服务拒绝了这次请求：{0}', [text.replace(/^service-error:\s*/, '').slice(0, 160)]);
	if (/HTTP (401|403)/.test(text)) return t('密钥无效，或这个密钥没有生图权限');
	if (/HTTP 429/.test(text)) return t('请求太频繁，或额度用完了，稍后再试');
	if (/HTTP 400/.test(text)) return t('服务拒绝了这次请求：{0}', [text.replace(/^HTTP 400:?\s*/, '').slice(0, 160) || t('描述可能不被接受')]);
	if (/empty-image/.test(text)) return t('服务没有返回图片，换个描述再试');
	if (/abort|timeout|timed out/i.test(text)) return t('等得太久了，已经取消');
	if (/not-ready/.test(text)) return t('这个生图模型还没填完整');
	return text.slice(0, 200);
}
