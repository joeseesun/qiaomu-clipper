import type { WebMedia } from './web-media-page';

// Put the strip in the site's content column where possible. Short-video feeds have
// fixed-height cards: use the free space beside their player, below site dialogs.
export function placeWebBar(host: HTMLElement, media: WebMedia | undefined, site: string): void {
	const doc = host.ownerDocument, win = doc.defaultView!;
	const video = media?.getBoundingClientRect();
	if (site === 'ted' && media) {
		const player = media.closest<HTMLElement>('[class*="aspect-video"]') || media.closest<HTMLElement>('[role="region"]');
		if (player?.parentElement) { host.classList.add('is-inline'); host.style.cssText = ''; player.after(host); return; }
	}
	if (site === 'douyin' && video) {
		const heading = Array.from(doc.querySelectorAll<HTMLElement>('h2,h3,div,p,span')).find(e => !e.children.length && e.textContent?.trim() === '推荐视频');
		let module = heading;
		while (module && module !== doc.body) {
			const r = module.getBoundingClientRect();
			if (r.left >= video.right && r.width >= 250 && r.width <= 440 && r.height > 60) {
				host.classList.add('is-inline'); host.style.cssText = ''; module.before(host); return;
			}
			module = module.parentElement ?? undefined;
		}
	}
	host.classList.remove('is-inline');
	if (!host.isConnected) doc.body.append(host);
	const left = video ? video.right + (site === 'tiktok' ? 88 : 20) : win.innerWidth - 366;
	const width = Math.min(340, win.innerWidth - left - 20);
	if (video && width >= 260) {
		host.style.cssText = `left:${left}px;right:auto;top:${Math.max(16, video.top + 12)}px;bottom:auto;width:${width}px;`;
	} else {
		// A narrow viewport has no spare column; keep a collapsed, bounded fallback.
		host.style.cssText = 'right:16px;bottom:16px;left:auto;top:auto;';
	}
}

export const WEB_BAR_STYLE = `.qiaomu-web-bar{position:fixed;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));z-index:20;font-family:inherit}
.qiaomu-web-bar.is-inline{position:relative;inset:auto;width:100%;margin:12px 0 18px;z-index:auto}
.qiaomu-web-bar .qiaomu-yt-bar{max-height:calc(100vh - 100px);font-family:inherit}
.qiaomu-web-bar .qiaomu-yt-bar-lines{max-height:min(48vh,calc(100vh - 250px))}
.qiaomu-web-bar .qiaomu-yt-bar{--qm-frame:1px solid var(--qm-line);--qm-margin:0;--qm-radius:12px}
`;
