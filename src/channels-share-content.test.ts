// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const share = 'https://weixin.qq.com/sph/Fixture123';
const send = vi.fn().mockResolvedValue(undefined);
let changed: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | undefined;
const load = async (href: string, off: string[] = []) => {
	vi.resetModules(); delete (window as unknown as { qiaomuChannelsShareLoaded?: boolean }).qiaomuChannelsShareLoaded;
	vi.stubGlobal('chrome', { runtime: { sendMessage: send }, i18n: { getUILanguage: () => 'zh-CN' }, storage: { local: { get: vi.fn().mockResolvedValue({ qiaomuStudySites: { off } }) }, onChanged: { addListener: (fn: typeof changed) => { changed = fn; } } } });
	Object.defineProperty(window, 'location', { value: new URL(href), configurable: true });
	await import('./channels-share-content'); await new Promise(resolve => setTimeout(resolve, 20));
};
beforeEach(() => { document.body.replaceChildren(); send.mockClear(); });
afterEach(() => { document.documentElement.querySelectorAll('div').forEach(node => { if (node.shadowRoot) node.remove(); }); vi.unstubAllGlobals(); });
const card = () => Array.from(document.documentElement.children).find(node => (node as HTMLElement).shadowRoot) as HTMLElement | undefined;

it('offers one real button on a share page and opens the study page through the existing read command', async () => {
	await load(share);
	const root = card()!.shadowRoot!, go = root.querySelector<HTMLButtonElement>('button.go')!;
	expect(go.tagName).toBe('BUTTON'); expect(go.textContent).toBe('用乔木剪藏打开');
	const css = root.querySelector('style')!.textContent!;
	expect(css).toMatch(/\.card\{[^}]*background:#fff/); expect(css).toMatch(/\.go:hover\{background:#000\}/); expect(css).toMatch(/button:focus-visible\{outline:1px solid/);
	go.click(); expect(send).toHaveBeenCalledWith({ action: 'qiaomuTripleKey', command: 'read' });
});
it('can be dismissed and stays off when the site is turned off', async () => {
	await load(share); card()!.shadowRoot!.querySelector<HTMLButtonElement>('button.x')!.click(); expect(card()).toBeUndefined();
	await load(share, ['channels']); expect(card()).toBeUndefined();
	changed?.({ qiaomuStudySites: { newValue: { off: [] } } }, 'local'); expect(card()).toBeDefined();
});
it('does nothing on other pages', async () => {
	await load('https://weixin.qq.com/sph/'); expect(card()).toBeUndefined();
	await load('https://weixin.qq.com/cgi-bin/x'); expect(card()).toBeUndefined();
});

it('also runs on the address a share link redirects to, and the manifests list both', async () => {
	await load('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123'); expect(card()).toBeDefined();
	const fs = await import('node:fs');
	for (const name of ['chrome', 'firefox', 'safari']) {
		const manifest = JSON.parse(fs.readFileSync(`src/manifest.${name}.json`, 'utf8')) as { content_scripts: Array<{ js?: string[]; matches: string[] }> };
		const entry = manifest.content_scripts.find(script => script.js?.includes('channels-share.js'))!;
		expect(entry.matches).toEqual(['https://weixin.qq.com/sph/*', 'https://channels.weixin.qq.com/finder-preview/pages/sph*']);
	}
});
