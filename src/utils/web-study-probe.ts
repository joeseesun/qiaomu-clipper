import { asrProbe, thisBrowser, type AsrReply, type CookieBrowser, type WebInfo } from './asr-client';

// Borrow browser state only after a click, for this item's read and subsequent subtitle download.
export async function probeWebStudy(url: string, status: HTMLElement, holder: HTMLElement,
	probe: typeof asrProbe = asrProbe): Promise<{ info: AsrReply<WebInfo>; cookies?: CookieBrowser }> {
	let info = await probe(url);
	if (info.ok || info.error !== 'needs-cookies') return { info };
	const doc = holder.ownerDocument, row = doc.createElement('div');
	const note = doc.createElement('p'); note.className = 'qiaomu-yt-gen-text';
	note.textContent = '本机下载工具会读取所选浏览器的 Cookie，用于这条内容；不会上传到字幕服务。请先在该浏览器打开并播放原视频。';
	const select = doc.createElement('select'); select.setAttribute('aria-label', '视频所在的浏览器');
	for (const browser of ['chrome', 'edge', 'brave', 'chromium', 'firefox', 'safari'] as const) {
		const option = doc.createElement('option'); option.value = browser; option.textContent = browser; select.append(option);
	}
	select.value = thisBrowser();
	const button = doc.createElement('button'); button.type = 'button'; button.className = 'qiaomu-yt-gen-button is-primary'; button.textContent = '使用浏览器状态重试';
	row.className = 'qiaomu-web-retry'; row.append(note, select, button); holder.append(row);
	status.textContent = '这个网站需要有效的浏览器状态才能读取，不一定需要登录。';
	return new Promise(resolve => {
		button.addEventListener('click', async () => {
			button.disabled = true; select.disabled = true; status.textContent = '正在重新读取…';
			const cookies = select.value as CookieBrowser;
			try { info = await probe(url, cookies); }
			catch { info = { ok: false, error: 'failed' }; }
			if (info.ok) { row.remove(); resolve({ info, cookies }); return; }
			status.textContent = info.error === 'needs-cookies'
				? '带浏览器状态读取仍失败。请刷新原视频、确认能播放后重试；抖音的下载解析也可能暂时失效。'
				: '重试读取失败：' + (info.message || info.error);
			button.disabled = false; select.disabled = false;
		});
	});
}
