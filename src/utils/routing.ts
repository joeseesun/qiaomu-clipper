import { initializeToggles } from './ui-utils';

export function updateUrl(section: string, templateId?: string, focus?: string): void {
	window.history.pushState({}, '', buildUrl(section, templateId, focus));
}

export function replaceUrl(section: string, templateId?: string, focus?: string): void {
	window.history.replaceState({}, '', buildUrl(section, templateId, focus));
}

function buildUrl(section: string, templateId?: string, focus?: string): string {
	const params = new URLSearchParams({ section });
	if (templateId) params.set('template', templateId);
	if (focus) params.set('focus', focus);
	return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

export function getUrlParameters(): { section: string | null, templateId: string | null, focus: string | null } {
	const urlParams = new URLSearchParams(window.location.search);
	return {
		section: urlParams.get('section'),
		templateId: urlParams.get('template')
		, focus: urlParams.get('focus')
	};
}
