// Group the bare player's controls without moving or reloading its live iframe.
// Once captions create the pinned player card, the existing card owns its controls.
export function mountStudyMediaFooter(article: HTMLElement): HTMLElement | undefined {
	let footer = article.querySelector<HTMLElement>(':scope > .study-media-footer');
	const card = article.querySelector<HTMLElement>('.player-container');
	if (card) {
		if (footer) {
			const bar = footer.querySelector('.youtube-mode-bar'); if (bar) card.append(bar);
			const download = footer.querySelector('.qiaomu-dl-host'); if (download) (card.querySelector('.player-toggles') || card).append(download);
			const quality = footer.querySelector('.bilibili-quality-link'); if (quality) card.append(quality);
			// Active generation panels are moved by the transcript regeneration control.
			if (!footer.querySelector('.youtube-study-feedback')) footer.remove();
		}
		return undefined;
	}
	const player = article.querySelector(':scope > .youtube-sized-player'); if (!player) return undefined;
	if (!footer) {
		footer = article.ownerDocument.createElement('div'); footer.className = 'study-media-footer';
		const toolbar = article.ownerDocument.createElement('div'); toolbar.className = 'study-media-toolbar';
		const actions = article.ownerDocument.createElement('div'); actions.className = 'study-media-actions'; toolbar.append(actions); footer.append(toolbar);
	}
	const anchor = article.querySelector(':scope > .youtube-player-resize') || player;
	if (footer.previousElementSibling !== anchor) anchor.after(footer);
	const toolbar = footer.querySelector('.study-media-toolbar')!;
	const bar = article.querySelector('.youtube-mode-bar'); if (bar && bar.parentElement !== toolbar) toolbar.prepend(bar);
	return footer;
}
