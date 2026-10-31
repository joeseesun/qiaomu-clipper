import browser from './browser-polyfill';
import { isSiteOn, loadStudySites, siteOf } from './study-sites';
import { isMediaItemAddress, webMediaAddress } from './web-media-page';

// Supported media detail pages share the native study player. A feed adapter supplies the currently playing item address.
export async function webStudyPath(url: string, tabId: number): Promise<string | null> {
	const site = siteOf(url); if (!site || site.builtin || !isSiteOn(await loadStudySites(), site.id)) return null;
	let post = webMediaAddress(url);
	const scoped = site.id === 'x' || site.id === 'xiaohongshu';
	try {
		const source = await browser.tabs.sendMessage(tabId, { action: 'qiaomuWebMediaSource' }) as { url?: unknown } | undefined;
		const found = typeof source?.url === 'string' && siteOf(source.url)?.id === site.id ? webMediaAddress(source.url) : null;
		// Mixed text/media sites need positive evidence from their current content,
		// not a global video query that also matches replies, GIFs and recommendations.
		if (scoped && !found) return null;
		if (site.id === 'x' && post && post.split('/').pop() !== found?.split('/').pop()) return null;
		if (found) post = found;
	} catch { if (scoped) return null; /* adapter not loaded */ }
	if (!post) return null;
	const path = `reader.html?study=web&url=${encodeURIComponent(post)}&sourceTab=${tabId}`;
	if (scoped) return path;
	try {
		const [result] = await browser.scripting.executeScript({ target: { tabId }, func: () => Boolean(document.querySelector('video, audio, iframe[src*="player.vimeo.com"], iframe[src*="player.twitch.tv"], iframe[src*="dailymotion.com"], [data-testid="videoPlayer"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"]')) });
		return result?.result || isMediaItemAddress(post) ? path : null;
	} catch { return null; }
}
