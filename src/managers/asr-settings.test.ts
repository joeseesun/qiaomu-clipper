// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, send: vi.fn() }));
vi.mock('../utils/browser-polyfill', () => ({ default: { runtime: { sendMessage: (...args: unknown[]) => state.send(...args) }, storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
import { initializeAsrSettings } from './asr-settings';

const HTML = `<div id="asr-settings"><select id="asr-default"></select><div id="asr-routes"></div><div id="asr-rec"></div><div class="checkbox-container"><input type="checkbox" id="asr-auto-start"></div>
<button id="asr-add"></button><div id="asr-grid"></div><div id="asr-status"></div></div>
<div id="asr-modal" class="modal-container"><div class="modal-bg"></div><div class="modal"><div id="asr-modal-title"></div><div id="asr-modal-body"></div><div id="asr-modal-actions"></div></div></div>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const change = (target: HTMLElement | string, value?: string) => { const node = (typeof target === 'string' ? el<HTMLInputElement>(target) : target) as HTMLInputElement; if (value !== undefined) node.value = value; node.dispatchEvent(new Event('change')); };
const settled = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const saved = () => state.store.qiaomuAsrSettings as { mode: string; engine: string; active: string; autoStart: boolean; routes: Record<string, string>; profiles: Array<Record<string, string>> };
const engine = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, sizeMb: 1300, note: '', supported: true, installed: false, modelReady: false, managed: true, ...over });
const helper = (local: unknown[]) => state.send.mockImplementation(async (message: { payload: { mode: string } }) => message.payload.mode === 'status' ? { ok: true, ready: false, missing: [], hints: [], engine: null, modelDownloadNeeded: false, local } : { ok: true });
const open = async () => { document.body.innerHTML = HTML; await initializeAsrSettings(); await settled(); };
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.asr-row'));
const row = (key: string) => document.querySelector<HTMLElement>(`.asr-row[data-key="${key}"]`)!;
const rec = (provider: string) => document.querySelector<HTMLElement>(`#asr-rec [data-provider="${provider}"]`)!;
const recLocal = () => document.querySelector<HTMLElement>('#asr-rec [data-kind="local"]')!;
const act = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === label)!.click();
const field = (id: string) => el<HTMLInputElement>(id);
const modalButtons = () => Array.from(el('asr-modal-actions').querySelectorAll<HTMLButtonElement>('button'));
const press = (label: string) => modalButtons().find(b => b.textContent === label)!.click();
beforeEach(async () => { state.store = {}; state.send.mockReset(); vi.restoreAllMocks(); helper([engine('mlx', { installed: true, modelReady: true }), engine('mlx-qwen3'), engine('faster-whisper')]); await open(); });

it('offers two clear starts: one recommended local engine and the two recommended cloud services, with one action each', () => {
	expect(recLocal().textContent).toContain('推荐'); expect(recLocal().textContent).toContain('Qwen3-ASR 0.6B（MLX）'); expect(recLocal().textContent).toContain('需要先下载，约 1.3 GB'); expect(Array.from(recLocal().querySelectorAll('button')).map(b => b.textContent)).toEqual(['安装']);
	expect(Array.from(document.querySelectorAll<HTMLElement>('#asr-rec [data-kind="cloud"] [data-provider]')).map(r => r.dataset.provider)).toEqual(['doubao', 'siliconflow']); expect(rec('doubao').textContent).toContain('速度最快'); expect(Array.from(rec('doubao').querySelectorAll('button')).map(b => b.textContent)).toEqual(['配置']);
	expect(document.querySelector('#asr-rec')!.textContent).not.toContain('Groq'); // nothing else to weigh up front
});

it('recommends the engine that runs anywhere when this computer cannot run the Apple one, and shows it ready once installed', async () => {
	helper([engine('mlx', { supported: false }), engine('mlx-qwen3', { supported: false }), engine('faster-whisper', { installed: true })]); await open();
	expect(recLocal().textContent).toContain('faster-whisper'); expect(recLocal().textContent).toContain('已就绪'); expect(recLocal().querySelector('button')).toBeNull(); expect(recLocal().querySelector('.asr-dot')!.classList.contains('is-ready')).toBe(true);
});

it('lists only what is the viewer\'s own: installed engines and saved services, each with a dot that is green when ready', async () => {
	expect(rows().map(r => r.dataset.key)).toEqual(['local:mlx']); expect(row('local:mlx').textContent).toContain('已安装'); expect(row('local:mlx').querySelector('.asr-dot')!.classList.contains('is-ready')).toBe(true);
	act(rec('glm') ?? rec('doubao'), '配置'); field('asr-f-key').value = ''; press('保存'); await settled(); // saved without a key
	const id = saved().profiles[0].id; expect(row(`cloud:${id}`).querySelector('.asr-dot')!.classList.contains('is-ready')).toBe(false); expect(row(`cloud:${id}`).textContent).toContain('还没填完');
});

it('says what to do when nothing is set up yet', async () => {
	helper([engine('mlx'), engine('mlx-qwen3'), engine('faster-whisper')]); await open(); expect(rows()).toHaveLength(0); expect(el('asr-grid').textContent).toContain('还没有');
});

it('has a default way of recognising and one choice per site, each able to follow the default', async () => {
	expect(Array.from(el<HTMLSelectElement>('asr-default').options).map(o => o.value)).toEqual(['local:auto', 'local:mlx', 'local:mlx-qwen3', 'local:faster-whisper']);
	const sites = Array.from(el('asr-routes').querySelectorAll('select')); expect(sites.map(s => s.id)).toEqual(['asr-route-youtube', 'asr-route-bilibili', 'asr-route-xiaoyuzhou', 'asr-route-file', 'asr-route-web']); expect(sites[0].value).toBe('');
	change('asr-default', 'local:mlx'); await settled(); expect(saved()).toMatchObject({ mode: 'local', engine: 'mlx' }); expect(row('local:mlx').textContent).toContain('默认');
	change('asr-route-bilibili', 'local:faster-whisper'); await settled(); expect(saved().routes).toEqual({ bilibili: 'local:faster-whisper' });
	change('asr-route-bilibili', ''); await settled(); expect(saved().routes).toEqual({}); // back to following the default
});

it('sets a cloud service up in a dialog from the recommendation: fields come filled in, the key is typed, and saving makes it ready everywhere', async () => {
	act(rec('siliconflow'), '配置'); expect(el('asr-modal').style.display).toBe('flex'); expect(el('asr-modal-title').textContent).toContain('添加 硅基流动');
	expect(field('asr-f-url').value).toBe('https://api.siliconflow.cn/v1'); expect(field('asr-f-model').value).toBe('Qwen/Qwen3-ASR-1.7B'); expect(el('asr-modal-body').textContent).toContain('推荐 Qwen3-ASR');
	expect(saved()).toBeUndefined(); field('asr-f-key').value = ' sk-abc '; press('保存'); await settled();
	expect(el('asr-modal').style.display).toBe('none'); expect(saved().profiles[0]).toMatchObject({ provider: 'siliconflow', apiKey: 'sk-abc', model: 'Qwen/Qwen3-ASR-1.7B' });
	const id = saved().profiles[0].id; expect(row(`cloud:${id}`).textContent).toContain('Qwen/Qwen3-ASR-1.7B'); expect(rec('siliconflow').textContent).toContain('已配置'); expect(rec('siliconflow').querySelector('button')).toBeNull();
	expect(Array.from(el<HTMLSelectElement>('asr-default').options).map(o => o.value)).toContain(`cloud:${id}`); change('asr-default', `cloud:${id}`); await settled(); expect(saved()).toMatchObject({ mode: 'cloud', active: id });
});

it('adds anything else from one dialog: other engines and every service, several models of one service told apart by name', async () => {
	document.querySelector<HTMLElement>('#asr-add')!.click(); const body = el('asr-modal-body'); expect(body.textContent).toContain('本机引擎'); expect(body.textContent).toContain('云端服务');
	const picks = Array.from(body.querySelectorAll<HTMLElement>('.asr-preset')).map(b => b.dataset.provider); expect(picks).toEqual(expect.arrayContaining(['mlx-qwen3', 'faster-whisper', 'siliconflow', 'groq', 'openai', 'local', 'custom'])); expect(picks).not.toContain('mlx'); // already installed
	body.querySelector<HTMLElement>('.asr-preset[data-provider="siliconflow"]')!.click(); field('asr-f-name').value = '便宜'; field('asr-f-key').value = 'sk-1'; press('保存'); await settled();
	document.querySelector<HTMLElement>('#asr-add')!.click(); el('asr-modal-body').querySelector<HTMLElement>('.asr-preset[data-provider="siliconflow"]')!.click(); field('asr-f-name').value = '稳定'; field('asr-f-model').value = 'FunAudioLLM/SenseVoiceSmall'; field('asr-f-key').value = 'sk-1'; press('保存'); await settled();
	const profiles = saved().profiles; expect(profiles.map(p => p.name)).toEqual(['便宜', '稳定']); expect(row(`cloud:${profiles[0].id}`).querySelector('.asr-row-name span')!.textContent).toBe('便宜'); expect(row(`cloud:${profiles[1].id}`).textContent).toContain('FunAudioLLM/SenseVoiceSmall');
});

it('opens an engine from the picker to install it, and does not list one that is already installed', async () => {
	document.querySelector<HTMLElement>('#asr-add')!.click(); const picks = Array.from(el('asr-modal-body').querySelectorAll<HTMLElement>('.asr-preset')).map(b => b.dataset.provider);
	expect(picks).not.toContain('mlx'); // already installed
	el('asr-modal-body').querySelector<HTMLElement>('.asr-preset[data-provider="faster-whisper"]')!.click(); expect(el('asr-modal-title').textContent).toContain('faster-whisper'); expect(modalButtons().map(b => b.textContent)).toContain('下载并安装');
});

it('tries what is typed in the dialog, without saving, and says what happened', async () => {
	act(rec('siliconflow'), '配置'); press('测试连接'); await settled(); expect(el('asr-modal-body').textContent).toContain('请先填写 API Key'); expect(state.send).not.toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ mode: 'test' }) }));
	field('asr-f-key').value = 'sk-typed'; field('asr-f-url').value = 'http://evil.example.com/v1'; press('测试连接'); await settled(); expect(el('asr-modal-body').textContent).toContain('https');
	field('asr-f-url').value = 'https://api.siliconflow.cn/v1'; state.send.mockResolvedValue({ ok: true, ms: 321 }); press('测试连接'); await settled();
	expect(state.send).toHaveBeenCalledWith({ action: 'qiaomuAsr', payload: { mode: 'test', cloud: expect.objectContaining({ baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B' }), apiKey: 'sk-typed' } });
	expect(JSON.stringify((state.send.mock.calls[state.send.mock.calls.length - 1][0] as { payload: { cloud: unknown } }).payload.cloud)).not.toContain('sk-typed'); expect(el('asr-modal-body').textContent).toContain('连接正常（321 ms）'); expect(saved()).toBeUndefined();
	state.send.mockResolvedValue({ ok: false, error: '云端识别鉴权失败，请检查 API Key', code: 'cloud-auth' }); press('测试连接'); await settled(); expect(el('asr-modal-body').textContent).toContain('测试失败：云端识别鉴权失败');
	state.send.mockRejectedValue(new Error('x')); press('测试连接'); await settled(); expect(el('asr-modal-body').textContent).toContain('没连上本地助手');
});

it('changes the fields to the service chosen in the dialog, asks for the request style only for a custom one, and cancels without saving', async () => {
	act(rec('siliconflow'), '配置'); field('asr-f-key').value = 'sk-keep'; change('asr-f-provider', 'glm'); await settled();
	expect(field('asr-f-url').value).toBe('https://open.bigmodel.cn/api/paas/v4'); expect(field('asr-f-model').value).toBe('glm-asr-2512'); expect(document.getElementById('asr-f-protocol')).toBeNull(); expect(el('asr-modal-title').textContent).toContain('智谱');
	change('asr-f-provider', 'custom'); await settled(); expect(field('asr-f-url').value).toBe(''); expect(document.getElementById('asr-f-protocol')).not.toBeNull();
	press('取消'); expect(el('asr-modal').style.display).toBe('none'); expect(saved()).toBeUndefined();
});

it('edits and deletes a saved service, deleting only after asking and falling back to the local engine when none is left', async () => {
	act(rec('doubao'), '配置'); field('asr-f-key').value = 'sk-d'; press('保存'); await settled(); const id = saved().profiles[0].id; change('asr-default', `cloud:${id}`); await settled();
	row(`cloud:${id}`).click(); expect(field('asr-f-key').value).toBe('sk-d'); field('asr-f-key').value = 'sk-new'; press('保存'); await settled(); expect(saved().profiles[0].apiKey).toBe('sk-new');
	const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); row(`cloud:${id}`).click(); press('删除'); await settled(); expect(saved().profiles).toHaveLength(1);
	confirm.mockReturnValue(true); press('删除'); await settled(); expect(saved().profiles).toHaveLength(0); expect(saved().mode).toBe('local'); expect(Array.from(rec('doubao').querySelectorAll('button')).map(b => b.textContent)).toEqual(['配置']);
});

it('installs the recommended engine with progress in the dialog and on the card, then shows it ready', async () => {
	vi.useFakeTimers(); act(recLocal(), '安装'); expect(el('asr-modal-title').textContent).toBe('Qwen3-ASR 0.6B（MLX）'); expect(el('asr-modal-body').textContent).toContain('还没有安装');
	const states = [{ state: 'installing', stage: '正在安装', progress: 30 }, { state: 'completed', stage: '安装完成', progress: 100 }];
	state.send.mockImplementation(async (message: { payload: { mode: string } }) => {
		if (message.payload.mode === 'install') return { ok: true, jobId: 'a'.repeat(32), engine: 'mlx-qwen3', state: 'queued', stage: '', progress: 0 };
		if (message.payload.mode === 'installPoll') return { ok: true, jobId: 'a'.repeat(32), engine: 'mlx-qwen3', ...states.shift()! };
		return { ok: true, ready: true, missing: [], hints: [], engine: 'mlx-qwen3', modelDownloadNeeded: false, local: [engine('mlx', { installed: true, modelReady: true }), engine('mlx-qwen3', { installed: true, modelReady: true })] };
	});
	press('下载并安装'); await vi.advanceTimersByTimeAsync(10); expect(modalButtons().map(b => b.textContent)).toContain('取消安装'); expect(recLocal().textContent).toContain('正在安装');
	await vi.advanceTimersByTimeAsync(1100); expect(el('asr-modal-body').textContent).toContain('30%'); await vi.advanceTimersByTimeAsync(1200);
	expect(recLocal().textContent).toContain('已就绪'); expect(row('local:mlx-qwen3')).toBeTruthy(); expect(el('asr-status').textContent).toBe('安装完成，可以使用。'); expect(modalButtons().map(b => b.textContent)).toEqual(expect.arrayContaining(['卸载', '设为默认']));
	vi.useRealTimers();
});

it('says why an install could not start, and uninstalls only after asking', async () => {
	act(recLocal(), '安装'); state.send.mockImplementation(async (message: { payload: { mode: string } }) => message.payload.mode === 'install' ? { ok: false, error: 'no-space', needMb: 4000, freeMb: 100 } : { ok: true, local: [] });
	press('下载并安装'); await settled(); expect(el('asr-status').textContent).toContain('磁盘空间不足'); press('关闭');
	row('local:mlx').click(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); state.send.mockClear(); press('卸载'); await settled(); expect(state.send).not.toHaveBeenCalled();
	confirm.mockReturnValue(true); state.send.mockResolvedValue({ ok: true, freedMb: 1700, local: [] }); press('卸载'); await settled();
	expect(state.send).toHaveBeenCalledWith({ action: 'qiaomuAsr', payload: { mode: 'uninstall', engine: 'mlx', model: true } }); expect(el('asr-status').textContent).toContain('已卸载');
});

it('makes an installed engine the default from its dialog, opens rows with the keyboard, and closes dialogs with Escape', async () => {
	row('local:mlx').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); press('设为默认'); await settled(); expect(saved()).toMatchObject({ mode: 'local', engine: 'mlx' }); expect(el('asr-modal').style.display).toBe('none');
	row('local:mlx').click(); expect(modalButtons().map(b => b.textContent)).not.toContain('设为默认'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(el('asr-modal').style.display).toBe('none');
});

it('keeps working while the helper is missing or old, and says so', async () => {
	state.send.mockResolvedValue({ ok: false, error: 'helper-offline' }); await open(); expect(el('asr-status').textContent).toContain('没有连上本地助手'); expect(recLocal().textContent).toContain('Qwen3-ASR');
	state.send.mockResolvedValue({ ok: false, error: 'helper-outdated' }); await open(); expect(el('asr-status').textContent).toContain('版本较旧');
});

it('saves "start straight away" and shows the saved choices again when the page opens', async () => {
	el<HTMLInputElement>('asr-auto-start').checked = true; change('asr-auto-start'); await settled(); expect(saved().autoStart).toBe(true);
	change('asr-route-youtube', 'local:mlx'); await settled(); await open(); expect(el<HTMLInputElement>('asr-auto-start').checked).toBe(true); expect(el<HTMLSelectElement>('asr-route-youtube').value).toBe('local:mlx');
});

it('turns settings saved with the single-service layout into a first saved service in the list', async () => {
	state.store.qiaomuAsrSettings = { mode: 'cloud', provider: 'stepfun', baseUrl: 'https://api.stepfun.com/v1', model: 'step-asr', apiKey: 'sk-saved', protocol: 'openai-transcriptions' }; await open();
	expect(row('cloud:p1').textContent).toContain('step-asr'); expect(el<HTMLSelectElement>('asr-default').value).toBe('cloud:p1');
});

 it('offers helper installation instead of trying to install a speech engine while the helper is offline', async () => {
 state.send.mockResolvedValue({ ok: false, error: 'helper-offline' }); await open();
 act(recLocal(), '安装');
 expect(modalButtons().map(b => b.textContent)).not.toContain('下载并安装');
 const setup = modalButtons().find(b => b.textContent === '安装或更新本地助手')!;
 expect(setup.dataset.gotoSection).toBe('clip'); setup.click();
 expect(el('asr-modal').style.display).toBe('none');
 expect(state.send.mock.calls.some(([msg]) => msg.payload?.mode === 'install')).toBe(false);
 });

it('offers an actionable helper repair inside a cloud test failure, without saving the draft', async () => {
 act(rec('siliconflow'), '配置'); field('asr-f-key').value = 'test-key';
 state.send.mockResolvedValue({ ok: false, error: 'helper-offline' }); press('测试连接'); await settled();
 const setup = el('asr-modal-body').querySelector<HTMLButtonElement>('[data-goto-section="clip"]')!;
 expect(setup).not.toBeNull(); expect(saved()).toBeUndefined();
 setup.click(); expect(el('asr-modal').style.display).toBe('none');
});
