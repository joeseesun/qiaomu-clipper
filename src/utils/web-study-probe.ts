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
	row.className = 'qiaomu-web-retry'; row.append(note, select, button); holder.append(row);
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

// 小鹅通: the replay is read as the signed-in viewer. Not signed in: open the shop's own sign-in page (WeChat scan, phone code),
// then read again. The study reader never sees the viewer's sign-in; the shop page keeps it.
export type XiaoeAnswer = import('./xiaoe').XiaoeReply | null;
export async function probeXiaoeLive(status: HTMLElement, holder: HTMLElement, read: () => Promise<XiaoeAnswer>,
	openTab: (url: string) => void): Promise<{ info: WebInfo; address: string } | { error: string; message?: string }> {
	const safeRead = async (): Promise<XiaoeAnswer> => { try { return await read(); } catch { return null; } };
	let reply = await safeRead();
	if (reply?.ok) return { info: reply.info, address: reply.address };
	if (!reply || reply.error !== 'login') return { error: reply?.error || 'failed', message: reply && 'message' in reply ? reply.message : undefined };
	const doc = holder.ownerDocument, row = doc.createElement('div'); row.className = 'qiaomu-web-retry'; row.setAttribute('role', 'group');
	const title = doc.createElement('b'); title.textContent = t('需要先登录小鹅通');
	const note = doc.createElement('p'); note.textContent = t('点「打开登录页」，在新页面用微信扫码（或手机验证码）登录这家店铺，登录完成后回到这里点「我已登录，重新读取」。请用你平时看课的同一个微信。');
	const actions = doc.createElement('div'); actions.className = 'qiaomu-web-retry-actions';
	const again = doc.createElement('button'); again.type = 'button'; again.className = 'qw-primary'; again.textContent = t('我已登录，重新读取');
	const login = doc.createElement('a'); login.href = reply.loginUrl; login.target = '_blank'; login.rel = 'noopener'; login.className = 'qw-secondary'; login.textContent = t('打开登录页');
	actions.append(again, login); row.append(title, note, actions); holder.append(row);
	status.textContent = '';
	return new Promise(resolve => {
		let done = false, busy = false, timer: ReturnType<typeof setInterval> | undefined;
		const settle = (value: { info: WebInfo; address: string } | { error: string; message?: string }) => { if (done) return; done = true; clearInterval(timer); row.remove(); resolve(value); };
		// One read; true when the page may move on.
		const attempt = async (): Promise<boolean> => {
			if (busy || done) return false; busy = true;
			try {
				reply = await safeRead();
				if (reply?.ok) { settle({ info: reply.info, address: reply.address }); return true; }
				if (reply && reply.error !== 'login') { settle({ error: reply.error, message: 'message' in reply ? reply.message : undefined }); return true; }
				return false;
			} finally { busy = false; }
		};
		// The reader turns links in the article into reader pages; the shop's sign-in page must open as itself, in its own tab.
		login.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			openTab(login.href);
			note.textContent = t('登录页已在新标签页打开。登录完成后这里会自动继续；也可以点「我已登录，重新读取」。');
			// Watch for the sign-in for a few minutes, so coming back is enough.
			clearInterval(timer); let left = 60;
			timer = setInterval(() => { if (--left < 0) { clearInterval(timer); return; } void attempt(); }, 3000);
		});
		again.addEventListener('click', async () => {
			again.disabled = true; again.textContent = t('正在读取…');
			const moved = await attempt();
			if (moved || done) return;
			note.textContent = t('还没读到登录状态。请确认登录页已经显示「我的」页面，并且不要关掉它，再点「我已登录，重新读取」。');
			again.disabled = false; again.textContent = t('我已登录，重新读取');
		});
	});
}
