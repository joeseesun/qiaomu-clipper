import { getUrlParameters, updateUrl, replaceUrl } from '../utils/routing';
import { updatePromptContextVisibility } from './interpreter-settings';
import { initializePropertyTypesManager } from './property-types-manager';

export type SettingsSection = 'general' | 'properties' | 'highlighter' | 'interpreter' | 'reader' | 'templates';

const VALID_SECTIONS: SettingsSection[] = ['general', 'properties', 'highlighter', 'interpreter', 'reader', 'templates'];
const LEGACY_AI_FOCUSES = new Set(['answer-subsection', 'translation-subsection', 'providers-subsection']);
let outlineObserver: IntersectionObserver | null = null;
let outlineSection: SettingsSection | null = null;
let isHandlingPopState = false;

function isSettingsSection(value: string | null | undefined): value is SettingsSection {
	return Boolean(value && VALID_SECTIONS.includes(value as SettingsSection));
}

function getSectionItems(section: SettingsSection): HTMLElement[] {
	const groups = Array.from(document.querySelectorAll<HTMLElement>(`#${section}-section .setting-group`));
	return groups.flatMap(group => {
		const headings = Array.from(group.querySelectorAll<HTMLElement>(':scope > .setting-item-heading'));
		return headings.length > 0 ? headings : [group];
	});
}

function getHeadingText(group: HTMLElement, index: number): string {
	const heading = group.matches('.setting-item-heading') ? group.querySelector('h3, h2') : group.querySelector('h3, h2, .usage-chart-name');
	const text = heading?.textContent?.trim() || group.dataset.settingsTitle;
	return text || `Section ${index + 1}`;
}

function focusGroup(group: HTMLElement, section: SettingsSection): void {
	const id = group.id || `${section}-group-${Array.from(group.parentElement?.children ?? []).indexOf(group)}`;
	group.id = id;
	group.classList.add('settings-outline-target');
	const url = new URL(window.location.href);
	url.searchParams.set('section', section);
	url.searchParams.set('focus', id);
	window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

function updateOutlineActive(id: string): void {
	document.querySelectorAll<HTMLElement>('#settings-outline-list [data-outline-target]').forEach(item => {
		const active = item.dataset.outlineTarget === id;
		item.classList.toggle('is-active', active);
		item.setAttribute('aria-current', active ? 'location' : 'false');
	});
}

function buildOutline(section: SettingsSection): void {
	const list = document.getElementById('settings-outline-list');
	const outline = document.getElementById('settings-outline');
	if (!list || !outline) return;

	if (outlineObserver) outlineObserver.disconnect();
	list.replaceChildren();
	outlineSection = section;
	const groups = getSectionItems(section);
	const validGroups = groups.filter(group => group.isConnected);
	if (validGroups.length < 2) {
		outline.classList.add('is-empty');
		return;
	}
	outline.classList.remove('is-empty');

	validGroups.forEach((group, index) => {
		const id = group.id || `${section}-group-${index + 1}`;
		group.id = id;
		group.classList.add('settings-outline-target');
		const item = document.createElement('li');
		const button = document.createElement('button');
		button.type = 'button';
		button.dataset.outlineTarget = id;
		button.textContent = getHeadingText(group, index);
	button.addEventListener('click', () => {
			if (group.classList.contains('is-collapsed')) group.click();
			group.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
			focusGroup(group, section);
			updateOutlineActive(id);
		});
		item.appendChild(button);
		list.appendChild(item);
	});

	outlineObserver = new IntersectionObserver(entries => {
		const visible = entries
			.filter(entry => entry.isIntersecting)
			.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
		if (!visible || outlineSection !== section) return;
		const id = (visible.target as HTMLElement).id;
		updateOutlineActive(id);
		const url = new URL(window.location.href);
		url.searchParams.set('section', section);
		url.searchParams.set('focus', id);
		window.history.replaceState({}, '', url.pathname + url.search + url.hash);
	}, { root: document.getElementById('settings-body'), rootMargin: '-12% 0px -68% 0px', threshold: [0, 0.1] });
	validGroups.forEach(group => outlineObserver?.observe(group));
	updateOutlineActive(validGroups[0].id);
}

function updateContentWorkspace(section: SettingsSection): void {
	const workspace = document.getElementById('content-workspace-nav');
	if (!workspace) return;
	const isContent = section === 'properties' || section === 'templates';
	workspace.classList.toggle('is-visible', isContent);
	workspace.querySelectorAll<HTMLButtonElement>('[data-content-section]').forEach(button => {
		const active = button.dataset.contentSection === section;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-selected', String(active));
	});
	workspace.querySelector<HTMLElement>('.content-template-tools')?.classList.toggle('is-visible', section === 'templates');
	workspace.querySelector<HTMLElement>('#template-list')?.classList.toggle('is-visible', section === 'templates');
}

function defaultOpenTargets(section: SettingsSection): number[] {
	switch (section) {
		case 'general': return [0, 3];
		case 'reader': return [1, 2];
		case 'interpreter': return [0, 1];
		case 'templates': return [0, 1];
		default: return [0, 1];
	}
}

function initializeCollapsibleGroups(section: SettingsSection): void {
	const targets = getSectionItems(section);
	const openByDefault = new Set(defaultOpenTargets(section));
	targets.forEach((target, index) => {
		if (!target.classList.contains('setting-item-heading')) return;
		const panel = target.nextElementSibling as HTMLElement | null;
		if (!panel?.classList.contains('setting-items')) return;
		if (target.dataset.collapsibleInitialized !== 'true') {
			target.dataset.collapsibleInitialized = 'true';
			target.classList.add('settings-group-toggle');
			target.setAttribute('role', 'button');
			target.setAttribute('tabindex', '0');
			const toggle = () => {
				const collapsed = target.classList.toggle('is-collapsed');
				panel.classList.toggle('is-collapsed', collapsed);
				target.setAttribute('aria-expanded', String(!collapsed));
			};
			target.addEventListener('click', toggle);
			target.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				toggle();
			});
			const collapsed = !openByDefault.has(index);
			target.classList.toggle('is-collapsed', collapsed);
			panel.classList.toggle('is-collapsed', collapsed);
			target.setAttribute('aria-expanded', String(!collapsed));
		}
	});
}

function closeMobileSidebar(restoreFocus = false): void {
	const settings = document.getElementById('settings');
	const menu = document.getElementById('hamburger-menu');
	const scrim = document.getElementById('sidebar-scrim');
	settings?.classList.remove('sidebar-open');
	menu?.classList.remove('is-active');
	menu?.setAttribute('aria-expanded', 'false');
	if (scrim) scrim.hidden = true;
	if (restoreFocus) (menu as HTMLButtonElement | null)?.focus();
}

export function showSettingsSection(section: SettingsSection, templateId?: string, focus?: string, options: { replace?: boolean } = {}): void {
	const sections = document.querySelectorAll('.settings-section');
	const sidebarItems = document.querySelectorAll('#sidebar li[data-section]');
	const normalizedFocus = section === 'interpreter' && focus && LEGACY_AI_FOCUSES.has(focus) ? undefined : focus;

	sections.forEach(s => s.classList.remove('active'));
	sidebarItems.forEach(item => item.classList.remove('active'));

	document.getElementById(`${section}-section`)?.classList.add('active');
	const selectedSidebarItem = document.querySelector<HTMLElement>(`#sidebar li[data-section="${section === 'templates' ? 'properties' : section}"]`);
	if (selectedSidebarItem) {
		selectedSidebarItem.classList.add('active');
		document.querySelectorAll('#sidebar li[data-section]').forEach(item => item.removeAttribute('aria-current'));
		selectedSidebarItem.setAttribute('aria-current', 'page');
	}

	if (options.replace) replaceUrl(section, templateId, normalizedFocus);
	else if (!isHandlingPopState) updateUrl(section, templateId, normalizedFocus);
	updateContentWorkspace(section);
	initializeCollapsibleGroups(section);
	buildOutline(section);
	updatePromptContextVisibility();

	if (section === 'properties') initializePropertyTypesManager();
	if (section === 'templates') document.getElementById('template-editor')?.style.setProperty('display', 'block');

	if (normalizedFocus) {
		const target = document.getElementById(normalizedFocus);
		if (target) window.setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
	}
}

function initializeContentWorkspace(): void {
	document.querySelectorAll<HTMLButtonElement>('[data-content-section]').forEach(button => {
		button.addEventListener('click', () => {
			const target = button.dataset.contentSection as SettingsSection | undefined;
			if (target === 'properties') showSettingsSection(target);
			if (target === 'templates') document.dispatchEvent(new CustomEvent('qiaomu-template-route'));
		});
	});
}

export function initializeSidebar(): void {
	const sidebar = document.getElementById('sidebar');
	const settingsContainer = document.getElementById('settings');
	const hamburgerMenu = document.getElementById('hamburger-menu');
	const sidebarTitle = document.getElementById('settings-sidebar-title');

	initializeContentWorkspace();
	sidebarTitle?.addEventListener('click', () => showSettingsSection('general'));

	sidebar?.addEventListener('click', event => {
		const li = (event.target as HTMLElement).closest('li[data-section]') as HTMLElement | null;
		const section = li?.dataset.section;
		if (isSettingsSection(section)) showSettingsSection(section, undefined, undefined);
		if (li) li.setAttribute('aria-current', 'page');
		closeMobileSidebar();
	});
	sidebar?.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const li = (event.target as HTMLElement).closest('li[data-section]') as HTMLElement | null;
		if (!li) return;
		event.preventDefault();
		li.click();
	});
	document.getElementById('sidebar-scrim')?.addEventListener('click', () => closeMobileSidebar(true));
	hamburgerMenu?.addEventListener('click', () => {
		const open = !settingsContainer?.classList.contains('sidebar-open');
		settingsContainer?.classList.toggle('sidebar-open', open);
		hamburgerMenu.classList.toggle('is-active', open);
		hamburgerMenu.setAttribute('aria-expanded', String(open));
		const scrim = document.getElementById('sidebar-scrim');
		if (scrim) scrim.hidden = !open;
		if (open) (sidebar?.querySelector('li[data-section]') as HTMLElement | null)?.focus();
	});
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && settingsContainer?.classList.contains('sidebar-open')) closeMobileSidebar(true);
	});

	window.addEventListener('popstate', () => {
		const { section, templateId, focus } = getUrlParameters();
		if (!isSettingsSection(section)) return;
		isHandlingPopState = true;
		showSettingsSection(section, templateId || undefined, focus || undefined, { replace: true });
		document.dispatchEvent(new CustomEvent('qiaomu-settings-route', { detail: { section, templateId, focus } }));
		isHandlingPopState = false;
	});
}
