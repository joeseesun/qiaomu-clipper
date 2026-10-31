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
			const close = text('', '关闭', 'Close');
			const host = document.createElement('div');
			host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;';
			const root = host.attachShadow({ mode: 'open' });
			const style = document.createElement('style');
			// Solid backgrounds (it sits over a scrolling page); a real button with a filled shape and its own hover and focus ring.
			style.textContent = `
				.card{box-sizing:border-box;display:flex;align-items:center;gap:14px;max-width:min(92vw,460px);padding:12px 12px 12px 16px;border:1px solid #d9d9d9;border-radius:14px;background:#fff;color:#1a1a1a;box-shadow:0 6px 24px rgba(0,0,0,.14);font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
				.words{min-width:0;flex:1}.words b{display:block;font-size:14px}.words span{display:block;margin-top:2px;color:#666;font-size:12px}
				button{all:unset;box-sizing:border-box;cursor:pointer;border-radius:10px;font:inherit;font-size:13px;line-height:1;white-space:nowrap}
				button:focus-visible{outline:1px solid #666;outline-offset:2px}
				.go{padding:10px 14px;background:#1a1a1a;color:#fff}.go:hover{background:#000}
				.x{padding:8px 10px;background:#f0f0f0;color:#444}.x:hover{background:#e4e4e4}
				@media (prefers-color-scheme:dark){.card{border-color:#3a3a3a;background:#232323;color:#f0f0f0}.words span{color:#aaa}.go{background:#f0f0f0;color:#111}.go:hover{background:#fff}.x{background:#333;color:#ddd}.x:hover{background:#3f3f3f}}`;
			const card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'group'); card.setAttribute('aria-label', title);
			const words = document.createElement('div'); words.className = 'words';
			const heading = document.createElement('b'); heading.textContent = title;
			const detail = document.createElement('span'); detail.textContent = note; words.append(heading, detail);
			const go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = action;
			const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'x'; dismiss.textContent = close; dismiss.setAttribute('aria-label', close);
			go.addEventListener('click', () => { try { void api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' }); } catch { detail.textContent = text('', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again'); } });
			dismiss.addEventListener('click', () => host.remove());
			card.append(words, go, dismiss); root.append(style, card);
			// The viewer can turn the site off in the supported-sites list.
			const apply = (value?: { off?: unknown }) => { const off = Array.isArray(value?.off) && (value!.off as unknown[]).includes('channels'); if (off) host.remove(); else if (!host.isConnected) document.documentElement.append(host); };
			api.storage.local?.get('qiaomuStudySites').then(data => apply(data?.qiaomuStudySites)).catch(() => apply());
			api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.qiaomuStudySites) apply(changes.qiaomuStudySites.newValue); });
		})();
	}
} catch { /* the extension was reloaded; the page needs a refresh */ }
