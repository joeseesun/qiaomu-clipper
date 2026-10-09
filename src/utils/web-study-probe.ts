import { asrProbe, thisBrowser, type AsrReply, type CookieBrowser, type WebInfo } from './asr-client';

import { t } from './ui-text';
// Douyin's loaded player is more reliable than the downloader's cookie extraction.
// Keep checking it on retry: a video may start loading after the reader opens.
export async function probeDouyinPage(url: string, status: HTMLElement, holder: HTMLElement,
	readPage: () => Promise<WebInfo | null | undefined>, patience = 2): Promise<{ info: WebInfo }> {
	const read = async () => { try { return await readPage(); } catch { return; } };
	// The player may still be starting: look again quietly before asking anything of the user.
	for (let attempt = 0; attempt <= patience; attempt++) {
		const found = await read(); if (found?.ok) return { info: found };
		if (attempt < patience) await new Promise(resolve => setTimeout(resolve, 1200));
	}
	const doc = holder.ownerDocument, row = doc.createElement('div'); row.className = 'qiaomu-web-retry'; row.setAttribute('role', 'group');
	const title = doc.createElement('b'); title.textContent = t('还没读到这条视频');
	const note = doc.createElement('p'); note.textContent = t('先回到抖音页面，让这条视频播放几秒，再点「重新读取」。');
	const actions = doc.createElement('div'); actions.className = 'qiaomu-web-retry-actions';
	const button = doc.createElement('button'); button.type = 'button'; button.className = 'qw-primary'; button.textContent = t('重新读取');
	const link = doc.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'qw-secondary'; link.textContent = t('打开原视频');
	actions.append(button, link); row.append(title, note, actions); holder.append(row);
	status.textContent = '';
	return new Promise(resolve => {
		button.addEventListener('click', async () => {
			button.disabled = true; button.textContent = t('正在读取…');
			const info = await read();
			if (info?.ok) { row.remove(); resolve({ info }); return; }
			note.textContent = t('还是没读到。请确认抖音页面里这条视频正在播放，且没有切换到别的视频。');
			button.disabled = false; button.textContent = t('重新读取');
		});
	});
}

// Borrow browser state only after a click, for this item's read and subsequent subtitle download.
export async function probeWebStudy(url: string, status: HTMLElement, holder: HTMLElement,
	probe: typeof asrProbe = asrProbe): Promise<{ info: AsrReply<WebInfo>; cookies?: CookieBrowser }> {
	let info = await probe(url);
	if (info.ok || info.error !== 'needs-cookies') return { info };
	const doc = holder.ownerDocument, row = doc.createElement('div');
	const note = doc.createElement('p'); note.className = 'qiaomu-yt-gen-text';
	note.textContent = t('本机下载工具会读取所选浏览器的 Cookie，用于这条内容；不会上传到字幕服务。请先在该浏览器打开并播放原视频。');
	const select = doc.createElement('select'); select.setAttribute('aria-label', t('视频所在的浏览器'));
	for (const browser of ['chrome', 'edge', 'brave', 'chromium', 'firefox', 'safari'] as const) {
		const option = doc.createElement('option'); option.value = browser; option.textContent = browser; select.append(option);
	}
	select.value = thisBrowser();
	const button = doc.createElement('button'); button.type = 'button'; button.className = 'qiaomu-yt-gen-button is-primary'; button.textContent = t('使用浏览器状态重试');
	const link = doc.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('打开原页面'); link.addEventListener('click', event => event.stopPropagation());
	row.className = 'qiaomu-web-retry'; row.append(note, select, button, link); holder.append(row);
	status.textContent = t('这个网站需要有效的浏览器状态才能读取，不一定需要登录。');
	return new Promise(resolve => {
		button.addEventListener('click', async () => {
			button.disabled = true; select.disabled = true; status.textContent = t('正在重新读取…');
			const cookies = select.value as CookieBrowser;
			try { info = await probe(url, cookies); }
			catch { info = { ok: false, error: 'failed' }; }
			if (info.ok) { row.remove(); resolve({ info, cookies }); return; }
			status.textContent = info.error === 'needs-cookies'
				? t('带浏览器状态读取仍失败。请刷新原视频、确认能播放后重试；抖音的下载解析也可能暂时失效。')
				: t('重试读取失败：') + (info.message || info.error);
			button.disabled = false; select.disabled = false;
		});
	});
}
