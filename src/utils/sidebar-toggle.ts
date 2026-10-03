import { createElement, PanelLeftClose, PanelLeftOpen } from 'lucide';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { getMessage } from './i18n';

export function mountSidebarToggle(sidebar: HTMLElement, key: string): void {
	if (sidebar.querySelector('.qiaomu-sidebar-toggle')) return;
	const doc = sidebar.ownerDocument;
	const content = doc.createElement('div'); content.className = 'qiaomu-sidebar-content';
	content.id = `sidebar-content-${crypto.randomUUID()}`;
	while (sidebar.firstChild) content.append(sidebar.firstChild);
	const button = doc.createElement('button'); button.type = 'button'; button.className = 'qiaomu-sidebar-toggle';
	button.setAttribute('aria-controls', content.id);
	const apply = (collapsed: boolean) => {
		content.hidden = collapsed; sidebar.classList.toggle('is-collapsed', collapsed);
		const label = getMessage(collapsed ? 'qiaomuExpandSidebar' : 'qiaomuCollapseSidebar');
		button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', String(!collapsed));
		button.replaceChildren(createElement(collapsed ? PanelLeftOpen : PanelLeftClose));
	};
	let touched = false;
	button.onclick = () => { touched = true; apply(!content.hidden); void setLocalStorage(key, content.hidden).catch(() => {}); };
	sidebar.prepend(button, content); apply(false);
	void getLocalStorage(key).then(saved => { if (!touched) apply(saved === true); }).catch(() => {});
}
