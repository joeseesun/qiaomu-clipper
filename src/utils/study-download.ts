import browser from './browser-polyfill';
import { mountDownloadButton } from './download-button';
import { guessChoice, DownloadError, fetchMediaBlob, downloadFileName } from './media-download';
import { canDownloadMedia, isYouTubeDownloadUrl } from './media-download-policy';
import { saveDownloadedBlob } from './browser-media-save';
import { downloadWithHelper } from './study-download-native';
import { t } from './ui-text';

const mounted = new WeakSet<HTMLElement>();
export async function mountStudyDownload(article: HTMLElement, player: HTMLVideoElement | undefined, options: { title: string; sourceUrl: string; mediaUrl: string; audioUrl?: string; video: boolean; split?: boolean }): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const declared = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes('downloads');
	if (!declared || player?.mediaKeys || isYouTubeDownloadUrl(options.sourceUrl) || isYouTubeDownloadUrl(options.mediaUrl) || mounted.has(article)) return;
	try { const source = new URL(options.sourceUrl); if (source.protocol !== 'https:' || source.username || source.password) return; } catch { return; }
	mounted.add(article);
	const direct = !options.split && canDownloadMedia(options.sourceUrl, options.mediaUrl);
	const CHOICE_KEY = 'qiaomuDownloadChoice';
	const kind = guessChoice(options.mediaUrl, options.video);
	const remembered = await browser.storage.local.get(CHOICE_KEY).then(values => (values as Record<string, string | undefined>)[CHOICE_KEY]).catch(() => undefined);
	const host = document.createElement('div'); host.className = 'qiaomu-dl-host';
	const place = () => {
		const card = article.querySelector<HTMLElement>('.player-container');
		const row = card?.querySelector<HTMLElement>(':scope > .player-toggles') || article.querySelector<HTMLElement>('.study-media-actions');
		const target = row || card || article;
		if (host.parentElement !== target) {
			host.style.cssText = 'display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;line-height:normal;vertical-align:middle;' + (target === card ? 'grid-column:2;grid-row:3;justify-self:end;padding:8px 0' : target === row ? 'margin-inline-start:auto' : 'margin:8px 0 16px');
			target.append(host);
		}
		if (target === article) {
			// The video and its controls exist before the transcript container does.
			// Keep downloads beside those controls, then follow the completed layout.
			const after = ['.youtube-mode-bar', '.reader-video-wrapper', '.youtube-player-resize', '.youtube-sized-player', '.qiaomu-audio-hero']
				.map(selector => article.querySelector(`:scope > ${selector}`)).find(Boolean);
			if (after && host.previousElementSibling !== after) after.after(host);
		}
	};
	place();
	const observer = new MutationObserver(place); observer.observe(article, { childList: true, subtree: true });
	const button = mountDownloadButton(host, {
		label: options.video ? t('下载视频') : t('下载音频'),
		title: options.title, remembered, sourceUrl: options.sourceUrl,
		beforeDownload: async () => {
			if (player?.mediaKeys || isYouTubeDownloadUrl(options.sourceUrl) || isYouTubeDownloadUrl(options.mediaUrl)) throw new DownloadError('policy', t('此来源不支持媒体下载'));
			if (direct && !__LOCAL_EDITION__ && !await browser.permissions.request({ permissions: ['downloads'] })) throw new DownloadError('permission', t('未获得下载权限，请再次点击下载并允许。'));
		},
		choices: [{ id: kind.kind, label: options.video ? t('视频') : t('音频'), url: options.mediaUrl, kind: kind.kind, ext: kind.ext }],
		onRemember: id => { void browser.storage.local.set({ [CHOICE_KEY]: id }); },
		save: saveDownloadedBlob,
		errorAction: { label: t('设置'), run: () => { window.open(browser.runtime.getURL('settings.html?section=asr-models'), '_blank', 'noopener'); } },
		download: async (choice, signal, progress) => {
			if (direct) {
				let blob: Blob;
				try { blob = await fetchMediaBlob(choice.url, { sourceUrl: options.sourceUrl, signal, onProgress: progress }); }
				catch (error) { if (signal.aborted || (error instanceof DownloadError && error.code === 'policy')) throw error; return downloadWithHelper(options, signal, progress); }
				return saveDownloadedBlob(blob, downloadFileName(options.title, choice.ext), signal);
			}
			return downloadWithHelper(options, signal, progress);
		},
	});
	host.title = t('仅下载你有权保存的内容');
	window.addEventListener('pagehide', () => { observer.disconnect(); button.destroy(); mounted.delete(article); }, { once: true });
}
