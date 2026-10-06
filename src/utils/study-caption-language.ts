import type { LanguageOption } from './subtitle-language';

// Switching a caption track changes only the transcript, retaining the playing media.
export function mountStudyCaptionLanguage(article: HTMLElement, options: LanguageOption[], selected: string,
	load: (id: string) => Promise<void>): void {
	if (options.length < 2 || article.querySelector('.study-caption-language')) return;
	const doc = article.ownerDocument, label = doc.createElement('label'); label.className = 'study-caption-language';
	const name = doc.createElement('span'); name.textContent = '字幕语言';
	const select = doc.createElement('select'); select.setAttribute('aria-label', '官方字幕语言');
	for (const item of options) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option); }
	select.value = selected;
	const status = doc.createElement('span'); status.setAttribute('role', 'status');
	label.append(name, select, status);
	const place = () => { const row = article.querySelector('.player-toggle-group'); if (row) row.append(label); else article.querySelector('.transcript')?.before(label); };
	place();
	select.addEventListener('change', async () => {
		const wanted = select.value; select.disabled = true; status.textContent = '正在切换…';
		try { await load(wanted); selected = wanted; status.textContent = ''; }
		catch { select.value = selected; status.textContent = '切换失败，已保留原字幕'; }
		finally { place(); select.disabled = false; }
	});
	if (!doc.getElementById('study-caption-language-style')) {
		const style = doc.createElement('style'); style.id = 'study-caption-language-style';
		style.textContent = `html .study-caption-language{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--text-muted,#666)}html .study-caption-language select{appearance:none;width:auto;max-width:180px;min-height:28px;padding:3px 8px;border:1px solid var(--background-modifier-border,#bbb);border-radius:6px;background:var(--background-primary,#fff);color:var(--text-normal,#222)}html .study-caption-language select:focus-visible{outline:2px solid var(--text-accent,#666);outline-offset:2px}`;
		doc.head.append(style);
	}
}
