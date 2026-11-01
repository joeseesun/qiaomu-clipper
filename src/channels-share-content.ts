import { createContentText } from './utils/content-i18n';
import { channelsShareAddress } from './utils/channels-study';

// On a Channels share page opened in an ordinary browser the site only says "open in WeChat". This card offers the way that works here: the clipper's
// study page reads the video through the viewer's own Tencent Yuanbao login. Nothing is changed in or sent from the page itself.
declare global { interface Window { qiaomuChannelsShareLoaded?: boolean } }

try {
	if (!window.qiaomuChannelsShareLoaded && channelsShareAddress(location.href)) {
		window.qiaomuChannelsShareLoaded = true;
		type Api = {
			runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
			i18n?: { getUILanguage?(): string };
			storage: { local?: { get(keys: string): Promise<Record<string, any>> }; onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void } };
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		void (async () => {
			const text = await createContentText(api);
			const title = text('', '乔木剪藏', 'Qiaomu Clipper');
			const note = text('', '在浏览器里生成字幕并沉浸学习这条视频', 'Subtitles and study mode for this video, right in the browser');
			const action = text('', '用乔木剪藏打开', 'Open with Qiaomu Clipper');
			const downloadAction = text('', '下载视频', 'Download Video');
			const close = text('', '关闭', 'Close');
			const host = document.createElement('div');
			host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;';
			const root = host.attachShadow({ mode: 'open' });
			const style = document.createElement('style');
			// Solid backgrounds (it sits over a scrolling page); a real button with a filled shape and its own hover and focus ring.
			style.textContent = `
				.card{box-sizing:border-box;display:flex;align-items:center;gap:14px;max-width:min(92vw,560px);padding:12px 12px 12px 16px;border:1px solid #d9d9d9;border-radius:14px;background:#fff;color:#1a1a1a;box-shadow:0 6px 24px rgba(0,0,0,.14);font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
				.words{min-width:0;flex:1}.words b{display:block;font-size:14px}.words span{display:block;margin-top:2px;color:#666;font-size:12px}
				button{all:unset;box-sizing:border-box;cursor:pointer;border-radius:10px;font:inherit;font-size:13px;line-height:1;white-space:nowrap}
				button:focus-visible{outline:1px solid #666;outline-offset:2px}
				.go{padding:10px 14px;background:#1a1a1a;color:#fff}.go:hover{background:#000}
				.dl{padding:10px 14px;background:#2563eb;color:#fff}.dl:hover{background:#1d4ed8}
				.x{padding:8px 10px;background:#f0f0f0;color:#444}.x:hover{background:#e4e4e4}
				@media (prefers-color-scheme:dark){.card{border-color:#3a3a3a;background:#232323;color:#f0f0f0}.words span{color:#aaa}.go{background:#f0f0f0;color:#111}.go:hover{background:#fff}.dl{background:#3b82f6;color:#fff}.dl:hover{background:#60a5fa}.x{background:#333;color:#ddd}.x:hover{background:#3f3f3f}}`;
			const card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'group'); card.setAttribute('aria-label', title);
			const words = document.createElement('div'); words.className = 'words';
			const heading = document.createElement('b'); heading.textContent = title;
			const detail = document.createElement('span'); detail.textContent = note; words.append(heading, detail);
			const go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = action;
			const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'dl'; dl.textContent = downloadAction;
			const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'x'; dismiss.textContent = close; dismiss.setAttribute('aria-label', close);
			let opening = false;
			go.addEventListener('click', () => {
				if (opening) return;
				opening = true;
				go.style.opacity = '0.7';
				const prev = go.textContent;
				go.textContent = text('', '正在打开...', 'Opening...');
				try {
					const promise = api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' });
					Promise.resolve(promise).then((res: any) => {
						if (res?.opened) {
							go.textContent = text('', '已打开', 'Opened');
							setTimeout(() => host.remove(), 1200);
						}
					}).catch(() => {
						detail.textContent = text('', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again');
					}).finally(() => {
						setTimeout(() => {
							opening = false;
							go.style.opacity = '1';
							if (go.textContent === text('', '正在打开...', 'Opening...')) go.textContent = prev;
						}, 2500);
					});
				} catch {
					detail.textContent = text('', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again');
					opening = false;
					go.style.opacity = '1';
					go.textContent = prev;
				}
			});

			let downloading = false;
			dl.addEventListener('click', async () => {
				if (downloading) return;
				downloading = true;
				dl.style.opacity = '0.7';
				const prev = dl.textContent;
				dl.textContent = text('', '正在解析...', 'Parsing...');

				const findMedia = (): string | undefined => {
					const video = document.querySelector('video');
					if (video?.src && video.src.startsWith('https://finder.video.qq.com/')) return video.src;
					if (video?.currentSrc && video.currentSrc.startsWith('https://finder.video.qq.com/')) return video.currentSrc;
					const entries = performance.getEntriesByType?.('resource') || [];
					for (let i = entries.length - 1; i >= 0; i--) {
						const name = (entries[i] as PerformanceResourceTiming).name;
						if (name && name.startsWith('https://finder.video.qq.com/') && name.includes('stodownload')) return name;
					}
				};

				const videoTitle = (document.querySelector('.feed-description, [class*="desc"]') as HTMLElement)?.textContent?.trim()
					|| document.title.replace(/_.*$/, '').replace(/ - .*$/, '').trim()
					|| '视频号视频';

				try {
					const localMedia = findMedia();
					const answer = await api.runtime.sendMessage({
						action: 'qiaomuChannelsDownload',
						url: location.href,
						mediaUrl: localMedia,
						title: videoTitle,
					}) as { success?: boolean; error?: string } | undefined;

					if (answer?.success) {
						dl.textContent = text('', '已开始下载', 'Downloading...');
						detail.textContent = text('', '视频已保存到浏览器下载目录', 'Video saved to your downloads');
					} else if (answer?.error === 'login') {
						dl.textContent = text('', '需登录元宝', 'Sign in');
						detail.textContent = text('', '请先点击“用乔木剪藏打开”，并在弹出的元宝窗口中扫码登录', 'Please sign in to Tencent Yuanbao first');
					} else {
						dl.textContent = text('', '解析失败', 'Failed');
						detail.textContent = answer?.error || text('', '未能获取视频下载地址，请尝试用乔木剪藏打开', 'Could not get video address; try opening in Clipper');
					}
				} catch {
					detail.textContent = text('', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again');
				} finally {
					setTimeout(() => {
						downloading = false;
						dl.style.opacity = '1';
						if (dl.textContent === text('', '正在解析...', 'Parsing...')) dl.textContent = prev;
					}, 3500);
				}
			});

			dismiss.addEventListener('click', () => host.remove());
			card.append(words, go, dl, dismiss); root.append(style, card);
			// The viewer can turn the site off in the supported-sites list.
			const apply = (value?: { off?: unknown }) => { const off = Array.isArray(value?.off) && (value!.off as unknown[]).includes('channels'); if (off) host.remove(); else if (!host.isConnected) document.documentElement.append(host); };
			api.storage.local?.get('qiaomuStudySites').then(data => apply(data?.qiaomuStudySites)).catch(() => apply());
			api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.qiaomuStudySites) apply(changes.qiaomuStudySites.newValue); });
		})();
	}
} catch { /* the extension was reloaded; the page needs a refresh */ }
