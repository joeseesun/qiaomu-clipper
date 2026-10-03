// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./storage-utils', () => ({getLocalStorage: (...args: unknown[]) => storage.get(...args), setLocalStorage: (...args: unknown[]) => storage.set(...args)}));
vi.mock('./i18n', () => ({getMessage: (key: string) => key}));
import { mountSidebarToggle } from './sidebar-toggle';
import { markdownHeadings, mountEditorOutline } from './editor-outline';
import { mountPlayerSize } from './youtube-player-size';
const flush = async () => { for (let i=0; i<10; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); storage.get.mockResolvedValue(undefined); storage.set.mockResolvedValue(undefined); });

it('restores the collapsed sidebar, keeps a usable expand control, and does not duplicate controls', async () => {
	storage.get.mockResolvedValue(true); document.body.innerHTML = '<aside><nav>Headings</nav></aside>';
	const sidebar = document.querySelector('aside')!; const original = sidebar.firstChild;
	mountSidebarToggle(sidebar, 'toc'); await flush();
	expect(sidebar.classList.contains('is-collapsed')).toBe(true);
	const button = sidebar.querySelector('button')!; expect(button.getAttribute('aria-expanded')).toBe('false');
	button.click(); expect(sidebar.querySelector('.qiaomu-sidebar-content')!.firstChild).toBe(original);
	expect(storage.set).toHaveBeenCalledWith('toc', false);
	mountSidebarToggle(sidebar, 'toc'); expect(sidebar.querySelectorAll('button')).toHaveLength(1);
});

it('never lets late saved state override a user click', async () => {
	let done!: (value: boolean) => void; storage.get.mockReturnValue(new Promise(resolve => {done=resolve;}));
	document.body.innerHTML='<aside>Text</aside>'; const sidebar=document.querySelector('aside')!;
	mountSidebarToggle(sidebar,'toc'); sidebar.querySelector('button')!.click(); done(false); await flush();
	expect(sidebar.classList.contains('is-collapsed')).toBe(true);
});

it('indexes actual Markdown headings including setext but excludes code, and jumps to an edit position', async () => {
	const markdown = '# First\n\n```md\n# Code\n```\n\nSecond\n------\n\n## Third\n';
	const headings = markdownHeadings(markdown);
	expect(headings.map(item => item.text)).toEqual(['First','Second','Third']);
	expect(markdown.slice(headings[2].offset)).toContain('## Third');
	document.body.innerHTML='<aside></aside><textarea></textarea>'; const textarea=document.querySelector('textarea')!; textarea.value=markdown;
	mountEditorOutline(document.querySelector('aside')!,textarea,false);
	const links=document.querySelectorAll<HTMLButtonElement>('.ce-toc button'); links[2].click();
	expect(textarea.selectionStart).toBe(headings[2].offset);
});

it('resizes the existing player, persists on commit, and reconnects to a replacement without duplicating controls', async () => {
	storage.get.mockResolvedValue(65); document.body.innerHTML='<article><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe></article>';
	const article=document.querySelector('article')!; const iframe=article.querySelector('iframe')!; const src=iframe.src;
	mountPlayerSize(article); await flush();
	expect(iframe.style.getPropertyValue('--youtube-player-width')).toBe('65%');
	const slider=article.querySelector('input')!; slider.value='50'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change'));
	expect(iframe.src).toBe(src); expect(article.querySelector('iframe')).toBe(iframe);
	expect(storage.set).toHaveBeenCalledWith('qiaomuYouTubePlayerSize',50);
	const replacement=iframe.cloneNode() as HTMLIFrameElement; iframe.replaceWith(replacement);
	mountPlayerSize(article); slider.value='75'; slider.dispatchEvent(new Event('input'));
	expect(replacement.style.getPropertyValue('--youtube-player-width')).toBe('75%');
	expect(article.querySelectorAll('.youtube-size-control')).toHaveLength(1);
});
