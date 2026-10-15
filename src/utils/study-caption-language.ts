import type { LanguageOption } from './subtitle-language';

import { t } from './ui-text';
// Switching a caption track changes only the transcript, retaining the playing media.
export function mountStudyCaptionLanguage(article: HTMLElement, options: LanguageOption[], selected: string,
	load: (id: string) => Promise<void>): void {
	if (options.length < 2 || article.querySelector('.study-caption-language')) return;
	const doc = article.ownerDocument, label = doc.createElement('label'); label.className = 'study-caption-language';
	const name = doc.createElement('span'); name.textContent = t('字幕语言');
	const select = doc.createElement('select'); select.setAttribute('aria-label', t('官方字幕语言'));
	for (const item of options) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option); }
	select.value = selected;
	const status = doc.createElement('span'); status.setAttribute('role', 'status');
	name.className = 'study-caption-language-name'; status.className = 'study-caption-language-status';
	select.title = t('字幕语言'); label.append(name, select, status);
	const place = () => { const row = article.querySelector('.player-toggle-group'); if (row) row.append(label); else article.querySelector('.transcript')?.before(label); };
	place();
	select.addEventListener('change', async () => {
		const wanted = select.value; select.disabled = true; status.textContent = t('正在切换…');
		try { await load(wanted); selected = wanted; status.textContent = ''; }
		catch { select.value = selected; status.textContent = t('切换失败，已保留原字幕'); }
		finally { place(); select.disabled = false; }
	});
	if (!doc.getElementById('study-caption-language-style')) {
		const style = doc.createElement('style'); style.id = 'study-caption-language-style';
		style.textContent = `html .study-caption-language{display:inline-flex;flex:0 0 auto;gap:6px;align-items:center;white-space:nowrap;min-width:0;font-size:13px;color:var(--text-muted,#666)}html .study-caption-language-name{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%)}html .study-caption-language select{appearance:none;width:auto!important;max-width:120px;min-width:64px;min-height:28px;margin:0;padding:4px 24px 4px 8px;border:1px solid var(--background-modifier-border,#bbb);border-radius:6px;box-shadow:none;background:var(--background-primary,#fff);color:var(--text-normal,#222);font:inherit;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6' fill='none' stroke='%23888' stroke-width='2'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center}html .study-caption-language select:focus{border-color:var(--field-focus-border);box-shadow:var(--field-focus-ring);outline:none}html .study-caption-language-status:empty{display:none}`;
		doc.head.append(style);
	}
}
