// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDownloadButton } from './download-button';
import { DownloadError } from './media-download';
import type { DownloadChoice } from './media-download';

const choices: DownloadChoice[] = [
	{ id: 'v1080', label: '1080p', url: 'https://v.example/1080.mp4', kind: 'video', ext: 'mp4', bytes: 48 * 1048576 },
	{ id: 'v720', label: '720p', url: 'https://v.example/720.mp4', kind: 'video', ext: 'mp4', bytes: 26 * 1048576 },
	{ id: 'a', label: 'm4a', url: 'https://v.example/a.m4a', kind: 'audio', ext: 'm4a', bytes: 3 * 1048576 },
];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = (over: Partial<Parameters<typeof mountDownloadButton>[1]> = {}) => {
	const host = document.createElement('div'); document.body.append(host);
	const save = vi.fn(async () => ({ reveal: vi.fn() }));
	const fetchBlob = vi.fn(async (_url: string, o?: { onProgress?: (d: number, t?: number) => void }) => { o?.onProgress?.(50, 100); return new Blob(['x']); });
	const button = mountDownloadButton(host, { title: '我们学英语都学错了！ #english', choices, save, fetchBlob: fetchBlob as never, ...over });
	return { host, button, save, fetchBlob, root: button.element };
};

describe('download button', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('says what it does and saves the default file with one press', async () => {
		const { root, save, fetchBlob } = mount();
		expect(root.querySelector('.qiaomu-dl-main')!.textContent).toBe('下载');
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click(); await tick(); await tick();
		expect(fetchBlob.mock.calls[0][0]).toBe('https://v.example/1080.mp4');
		expect(save).toHaveBeenCalledWith(expect.any(Blob), '我们学英语都学错了！.mp4');
		expect(root.dataset.state).toBe('done'); expect(root.textContent).toContain('已保存'); expect(root.textContent).toContain('在访达中显示');
	});

	it('lists video and audio apart, marks the current one and downloads the one picked, remembering it', async () => {
		const remember = vi.fn(); const { root, fetchBlob } = mount({ onRemember: remember, remembered: 'v720' });
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-more')!.click();
		const menu = root.querySelector('.qiaomu-dl-menu') as HTMLElement; expect(menu.hidden).toBe(false);
		expect(Array.from(menu.querySelectorAll('.qiaomu-dl-group')).map(g => g.textContent)).toEqual(['视频', '仅音频']);
		const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.qiaomu-dl-item'));
		expect(items.map(i => i.textContent)).toEqual(['1080p48 MB', '720p26 MB', 'm4a3 MB']);
		expect(items[1].getAttribute('aria-checked')).toBe('true'); expect(items[0].getAttribute('aria-checked')).toBe('false');
		items[2].click(); await tick(); await tick();
		expect(remember).toHaveBeenCalledWith('a'); expect(fetchBlob.mock.calls[0][0]).toBe('https://v.example/a.m4a');
		expect(menu.hidden).toBe(true);
	});

	it('shows the progress on the control itself and lets the person cancel', async () => {
		let abort!: () => void;
		const fetchBlob = vi.fn((_url: string, o?: { signal?: AbortSignal; onProgress?: (d: number, t?: number) => void }) => new Promise<Blob>((_, reject) => { o?.onProgress?.(42, 100); abort = () => reject(new DownloadError('cancelled', '已取消')); o?.signal?.addEventListener('abort', abort); }));
		const { root } = mount({ fetchBlob: fetchBlob as never });
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click(); await tick();
		expect(root.dataset.state).toBe('running'); expect(root.textContent).toContain('正在下载 42%');
		expect((root.querySelector('.qiaomu-dl-bar > i') as HTMLElement).style.width).toBe('42%');
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-link')!.click(); await tick(); await tick();
		expect(root.dataset.state).toBe('idle'); expect(root.querySelector('.qiaomu-dl-main')!.textContent).toBe('下载');
	});

	it('says why a download failed and offers a retry', async () => {
		const fetchBlob = vi.fn().mockRejectedValueOnce(new DownloadError('http', 'HTTP 403')).mockResolvedValue(new Blob(['x']));
		const { root, save } = mount({ fetchBlob: fetchBlob as never });
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click(); await tick(); await tick();
		expect(root.dataset.state).toBe('error'); expect(root.textContent).toContain('链接已失效'); expect(root.querySelector('[role=status]')).not.toBeNull();
		Array.from(root.querySelectorAll<HTMLButtonElement>('.qiaomu-dl-link')).find(b => b.textContent === '重试')!.click(); await tick(); await tick();
		expect(save).toHaveBeenCalledOnce(); expect(root.dataset.state).toBe('done');
	});

	it('hides the arrow when there is nothing to choose and the whole control when there is nothing to download', () => {
		expect(mount({ choices: [choices[0]] }).root.querySelector<HTMLElement>('.qiaomu-dl-more')!.hidden).toBe(true);
		expect(mount({ choices: [] }).root.querySelector<HTMLElement>('.qiaomu-dl-split')!.hidden).toBe(true);
	});

	it('keeps the arrow out of sight, whatever the style sheet says, when there is nothing to choose', () => {
		const { root } = mount({ choices: [choices[0]] }); const more = root.querySelector<HTMLElement>('.qiaomu-dl-more')!;
		expect(more.hidden).toBe(true);
		expect(document.getElementById('qiaomu-dl-style')!.textContent).toContain('.qiaomu-dl [hidden]{display:none!important}');
	});

	it('closes the menu with Escape without letting the page hear it', () => {
		const { root } = mount(); const heard = vi.fn(); document.body.addEventListener('keydown', heard);
		root.querySelector<HTMLButtonElement>('.qiaomu-dl-more')!.click();
		root.querySelector('.qiaomu-dl-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect((root.querySelector('.qiaomu-dl-menu') as HTMLElement).hidden).toBe(true); expect(heard).not.toHaveBeenCalled();
	});
});
