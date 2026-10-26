import { h } from '../write/editor/dom';
import { t } from './ui-text';
import { requestChatTool, downloadChatPhoto, chatCapabilities } from './chat-tools-client';
import { searchFailure } from './web-search';
import { saveLibraryImage, inspectLibraryBlob, readLibraryBlob } from './image-library-store';
import type { UnsplashPhoto } from './image-library-sources';
import type { ChatToolResult } from './chat-tools-types';
import browser from './browser-polyfill';
import { createElement, Globe } from 'lucide';

export async function keepChatPhoto(photo: UnsplashPhoto, signal?: AbortSignal): Promise<Blob> {
	const id = `unsplash-${photo.id}`, stored = await readLibraryBlob(id);
	if (stored) return stored;
	const blob = await downloadChatPhoto(photo, signal);
	const dimensions = await inspectLibraryBlob(blob);
	await saveLibraryImage(blob, { id, name: photo.description, created: Date.now(), source: 'unsplash', credit: { name: photo.author, url: photo.authorLink || photo.link }, ...dimensions });
	return blob;
}
export interface ToolViewOptions {
	readOnly?: boolean;
	persist: () => Promise<void>; followup: (text: string) => void;
	insert?: (photo: UnsplashPhoto, blob: Blob) => Promise<void>;
}
export function mountChatTools(parent: HTMLElement, results: ChatToolResult[], options: ToolViewOptions): void {
	for (const result of results) {
		if (result.error === 'english-image-query-required' && results.some(r => r.call.type === 'search_images' && r.state === 'done')) continue;
		const card = h('section', { class: 'qm-tool-result', 'aria-busy': String(result.state === 'running') });
		const imageSearch = result.call.type === 'search_images';
		const title = imageSearch ? `${result.call.type === 'search_images' ? result.call.label || result.call.query || t('热门图片') : ''} · Unsplash`
			: result.call.type === 'search_web' ? t('搜索：{0}', [result.call.query]) : result.call.type === 'read_web' ? t('读取网页') : t('使用图片');
		card.append(h('div', { class: 'qm-tool-title', text: title }));
		const status = h('p', { class: 'qm-tool-status', role: 'status' }); card.append(status);
		if (result.state === 'running') status.textContent = imageSearch ? t('正在搜索图片…') : t('正在搜索网页…');
		if (result.state === 'error') {
			status.textContent = result.error === 'unsplash-unconfigured' ? t('连接 Unsplash 后继续找图。') : result.error === 'search-unconfigured' ? t('先连接搜索服务，即可继续查找。')
				: result.error === 'interrupted' ? t('上次搜索已中断，可重新搜索。') : result.error === 'english-image-query-required' ? t('暂时未能完成搜索，请查看提示后重试。') : result.error || t('搜索失败');
			const retry = async () => {
				status.textContent = t('正在搜索…');
				try {
					const output = await requestChatTool(result.call); Object.assign(result, output, { state: 'done' }); delete result.error;
					await options.persist(); const holder = h('div'); mountChatTools(holder, [result], options); card.replaceWith(...Array.from(holder.children));
				} catch (error) { status.textContent = searchFailure(error); }
			};
			const setup = result.error === 'unsplash-unconfigured' || result.error === 'search-unconfigured';
			const button = h('button', { type: 'button', text: setup ? t('连接服务') : t('重试'), disabled: result.call.type === 'use_image' });
			button.onclick = () => {
				if (result.error === 'unsplash-unconfigured') void import('./image-library').then(m => m.openUnsplashSettings(() => void retry()));
				else if (result.error === 'search-unconfigured') void import('../managers/web-search-settings').then(m => m.openWebSearchSettings(() => void retry()));
				else void retry();
			}; if (!options.readOnly) card.append(button);
		}
		if (imageSearch && result.state === 'done') {
			const grid = h('div', { class: 'qm-photo-grid' });
			(result.photos || []).forEach((photo, index) => {
				const thumb = h('button', { type: 'button', class: 'qm-photo-preview', 'aria-label': t('预览图片 {0}', [index + 1]) }, options.readOnly ? h('span', { text: photo.description || t('查看图片') }) : h('img', { src: photo.thumb, alt: photo.description, loading: 'lazy', referrerpolicy: 'no-referrer' }), h('span', { text: String(index + 1) }));
				thumb.onclick = () => {
					const dialog = h('dialog', { class: 'qm-photo-dialog', 'aria-label': photo.description });
					const close = () => { dialog.close(); dialog.remove(); };
					dialog.append(h('button', { type: 'button', text: t('关闭'), onclick: close }), h('img', { src: photo.full, alt: photo.description }), h('a', { href: photo.link, target: '_blank', rel: 'noopener noreferrer', text: `${photo.author} · Unsplash` }));
					dialog.oncancel = event => { event.preventDefault(); close(); }; document.body.append(dialog); dialog.showModal();
				};
				const actions = h('div', { class: 'qm-photo-actions' });
				const act = (insert: boolean) => {
					const button = h('button', { type: 'button', text: insert ? t('插入文章') : t('保存到图库') });
					button.onclick = () => {
						button.disabled = true;
						void keepChatPhoto(photo).then(async blob => { if (insert) await options.insert?.(photo, blob); button.textContent = t('已完成'); }).catch(error => { status.textContent = searchFailure(error); }).finally(() => { button.disabled = false; });
					}; return button;
				};
				if (!options.readOnly) { actions.append(act(false)); if (options.insert) actions.append(act(true)); }
				grid.append(h('div', { class: 'qm-photo' }, thumb, h('div', { class: 'qm-photo-credit' },
					h('a', { href: photo.authorLink || photo.link, target: '_blank', rel: 'noopener noreferrer', text: photo.author }), ' · ',
					h('a', { href: photo.link, target: '_blank', rel: 'noopener noreferrer', text: 'Unsplash' })), actions));
			});
			card.append(grid);
			if (!result.photos?.length) status.textContent = t('没有找到匹配图片，可以换个关键词。');
			const more = h('button', { type: 'button', text: t('换一批'), onclick: () => options.followup(t('沿用刚才的主题和筛选条件，再找一批图片。')) });
			const gallery = h('button', { type: 'button', text: t('在图库查看更多'), onclick: () => {
				if (result.call.type === 'search_images') void browser.tabs.create({ url: browser.runtime.getURL(`image-library.html?tab=unsplash&q=${encodeURIComponent(result.call.query)}`) });
			} });
			if (!options.readOnly) card.append(h('div', { class: 'qm-tool-actions' }, more, gallery));
		}
		if (result.sources?.length) {
			const details = h('details', { class: 'qm-tool-sources' }, h('summary', { text: t('来源 {0}', [result.sources.length]) }));
			for (const source of result.sources) details.append(h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.title }));
			card.append(details);
		}
		if (result.call.type === 'use_image' && result.state === 'done') status.textContent = t('已完成');
		parent.append(card);
	}
}

export function createSearchToggle(): HTMLButtonElement {
	const button = h('button', { type: 'button', class: 'qm-search-toggle', 'aria-label': t('联网搜索'), 'aria-pressed': 'true' });
	let enabled = true;
	let interacted = false;
	void chatCapabilities().then(c => { if (!interacted) { enabled = c.webEnabled; paint(); } }).catch(() => {});
	function paint() {
		const label = enabled ? t('联网：自动') : t('联网：关闭');
		button.setAttribute('aria-pressed', String(enabled));
		button.title = label;
		button.setAttribute('aria-label', label);
		button.replaceChildren(createElement(Globe));
	}
	paint();
	button.onclick = () => { interacted = true; button.disabled = true; void requestChatTool({ type: 'set_search_enabled', enabled: !enabled }).then(() => { enabled = !enabled; paint(); }).catch(error => { button.title = searchFailure(error); }).finally(() => { button.disabled = false; }); };
	return button;
}
