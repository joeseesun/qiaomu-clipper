import { initializeToggles } from './ui-utils';

export function updateUrl(section: string, templateId?: string, focus?: string): void {
	let url = `${window.location.pathname}?section=${section}`;
	if (templateId) {
		url += `&template=${templateId}`;
	}
	if (focus) url += `&focus=${encodeURIComponent(focus)}`;
	window.history.pushState({}, '', url);
}

export function getUrlParameters(): { section: string | null, templateId: string | null, focus: string | null } {
	const urlParams = new URLSearchParams(window.location.search);
	return {
		section: urlParams.get('section'),
		templateId: urlParams.get('template')
		, focus: urlParams.get('focus')
	};
}
