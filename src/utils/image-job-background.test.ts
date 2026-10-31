import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(async () => ({ ok: true })), native: vi.fn(), ready: [] as any[] }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { id: 'own', getURL: (p: string) => `chrome-extension://own/${p}`, sendMessage: state.send } } }));
vi.mock('./native-helper-call', () => ({ callHelper: state.native }));
vi.mock('./storage-utils', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn(), getLocalStorage: async () => 'zh_CN' }));
vi.mock('../write/image-models', () => ({
	ASPECTS: ['1:1'], loadImageModels: async () => ({}), readyModels: () => state.ready, modelsOf: (c: any) => [c.model], labelOf: () => 'Image model', providerOf: () => undefined,
}));
import { handleImageJobs } from './image-job-background';
beforeEach(() => { vi.clearAllMocks(); state.ready = []; });
it('denies website content scripts and unrelated extensions before touching the helper or a provider', async () => {
	const request = { action: 'codexImageStart', id: 'new-job-id', prompt: 'Cat' };
	expect(await handleImageJobs(request, { id: 'own', url: 'https://example.test/', tab: {} } as any)).toMatchObject({ ok: false });
	expect(await handleImageJobs(request, { id: 'foreign', url: 'chrome-extension://own/popup.html' })).toMatchObject({ ok: false });
	expect(state.native).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});
it('forwards only allowed native fields, never commands or file paths', async () => {
	state.native.mockResolvedValue({ ok: true });
	await handleImageJobs({ action: 'codexImageRead', id: 'existing-job', offset: 0, path: '/private/file', command: 'arbitrary' }, { id: 'own', url: 'chrome-extension://own/image-runner.html' });
	expect(state.native.mock.calls[0][0]).toEqual({ action: 'codexImageRead', id: 'existing-job', offset: 0, prompt: undefined, model: undefined });
	expect(handleImageJobs({ action: 'arbitrary' }, {})).toBeUndefined();
});
