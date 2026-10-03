import { buildPanelActions, PANEL_STYLE, syncPanelActions } from './utils/youtube-panel-actions';

// Runs on YouTube pages only. Adds copy / download / immersive-study chips to the transcript panel.
declare global { interface Window { qiaomuYouTubePanelLoaded?: boolean } }

try {
	if (!window.qiaomuYouTubePanelLoaded) {
		window.qiaomuYouTubePanelLoaded = true;
		type Api = {
			runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
			i18n: { getMessage(key: string): string };
			storage: {
				sync?: { get(key: string): Promise<Record<string, any>> };
				onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void };
			};
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		const zh = /^zh/i.test(navigator.language);
		const text = (key: string, zhText: string, enText: string) => api.i18n.getMessage(key) || (zh ? zhText : enText);
		const strings = {
			copy: text('youtubePanelCopy', '复制', 'Copy'),
			download: text('youtubePanelDownload', '下载', 'Download'),
			study: text('youtubePanelStudy', '沉浸学习', 'Study'),
			copied: text('youtubePanelCopied', '已复制', 'Copied'),
			empty: text('youtubePanelEmpty', '没有读到字幕，请先展开转写文稿', 'No transcript lines found. Open the transcript first.'),
		};
		let enabled = true;
		const style = document.createElement('style'); style.textContent = PANEL_STYLE;
		let frame = 0;
		const refresh = () => {
			frame = 0;
			if (!enabled) { document.querySelectorAll('.qiaomu-yt-actions').forEach(node => node.remove()); return; }
			if (!style.isConnected) (document.head || document.documentElement).append(style);
			syncPanelActions(document, panel => buildPanelActions(document, panel, {
				strings,
				title: () => document.title,
				openStudy: () => { try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' })?.catch?.(() => {}); } catch { /* extension reloaded; refresh the page */ } },
			}));
		};
		// YouTube is a single-page app and re-renders the panel often; coalesce mutations per frame.
		const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
		new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
		const apply = (settings?: { youtubePanelActions?: boolean }) => { enabled = settings?.youtubePanelActions !== false; schedule(); };
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue); });
		schedule();
	}
} catch {
	// The extension may have been updated while this page was open.
}
