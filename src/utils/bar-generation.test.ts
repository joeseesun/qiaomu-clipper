import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confirmFor, createBarGeneration, viaOf } from './bar-generation';
import browser from './browser-polyfill';
import type { AsrJob } from './asr-client';
import type { GenerationDeps } from './subtitle-generation';
import type { GenUi } from './subtitle-generation-panel';

const KEY = 'bilibili:BV1hM4m1U7rA:20', OTHER = 'youtube:dbqweBCynuI', ID = 'b'.repeat(32);
const job = (over: Partial<AsrJob> = {}): AsrJob => ({ ok: true, id: ID, videoKey: KEY, state: 'transcribing', stage: 'x', progress: 10, segments: [], next: 0, ...over });
let current: string | null, shown: Array<GenUi | null>, applied: Array<[string, number, boolean]>, saved: Array<[string, number]>, reverted: string[];
const make = (deps: Partial<GenerationDeps> = {}, extra: { openSettings?: () => void } = {}) => {
	const full: GenerationDeps = { status: vi.fn(async () => ({ ok: true as const, ready: true, missing: [], hints: [], engine: 'mlx', modelDownloadNeeded: true })), start: vi.fn(async () => job()), poll: vi.fn(async () => job({ state: 'completed', progress: 100, segments: [{ start: 0, end: 2, text: '你好' }], next: 1, language: 'zh' })), cancel: vi.fn(async () => job({ state: 'cancelled' })), ...deps };
	const bar = { setGeneration: (ui: GenUi | null) => shown.push(ui) } as any;
	const gen = createBarGeneration({ videoKey: () => current, bar: () => bar, apply: (k, lines, done) => applied.push([k, lines.length, done]), revert: k => reverted.push(k), save: (k, lines) => saved.push([k, lines.length]), deps: full, intervalMs: 5, ...extra });
	return { gen, full };
};
const settle = async () => { for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(5); };
beforeEach(() => { vi.useFakeTimers(); current = KEY; shown = []; applied = []; saved = []; reverted = []; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('checks the helper, asks for confirmation (with the model note), then runs and saves the finished transcript', async () => {
	const { gen, full } = make();
	gen.actions.request(); expect(shown[shown.length - 1]).toEqual({ kind: 'checking' }); await settle();
	expect(shown[shown.length - 1]).toEqual({ kind: 'confirm', modelDownload: true }); expect(full.start).not.toHaveBeenCalled(); // nothing starts before the viewer agrees
	gen.actions.confirm(); await settle();
	expect(full.start).toHaveBeenCalledWith(KEY, 'auto');
	expect(applied).toContainEqual([KEY, 1, true]); expect(saved).toEqual([[KEY, 1]]); expect(shown[shown.length - 1]).toMatchObject({ kind: 'generated' });
});

it('shows setup guidance when the helper cannot do it, and nothing is applied', async () => {
	const { gen } = make({ status: vi.fn(async () => ({ ok: true as const, ready: false, missing: ['yt-dlp'], hints: ['brew install yt-dlp ffmpeg'], engine: null, modelDownloadNeeded: false })) });
	gen.actions.request(); await settle();
	expect(shown[shown.length - 1]).toEqual({ kind: 'setup', reason: 'missing', hints: ['brew install yt-dlp ffmpeg'] }); expect(applied).toEqual([]);
});

it('reverts to "no subtitles" on failure or cancel, and a failure offers a retry', async () => {
	const failing = make({ poll: vi.fn(async () => job({ state: 'failed', error: '音频下载失败', segments: [], next: 0 })) });
	failing.gen.actions.confirm(); await settle();
	expect(reverted).toEqual([KEY]); expect(shown[shown.length - 1]).toEqual({ kind: 'failed', error: '音频下载失败' });
	reverted = []; const slow = make({ poll: vi.fn(async () => job()) });
	slow.gen.actions.confirm(); await settle(); slow.gen.actions.cancel(); await settle();
	expect(slow.full.cancel).toHaveBeenCalledWith(ID); expect(reverted).toEqual([KEY]); expect(shown[shown.length - 1]).toBeNull();
});

it('never saves a failed partial transcript, including a failed regeneration over an existing result', async () => {
	for (const regenerate of [false, true]) {
		saved = []; reverted = []; applied = [];
		const { gen } = make({ start: vi.fn(async () => job({ segments: [{ start: 0, end: 2, text: 'partial' }], next: 1 })), poll: vi.fn(async () => job({ state: 'failed', error: 'CUDA failure', next: 1 })) });
		if (regenerate) { gen.actions.regenerate!(); await settle(); }
		gen.actions.confirm(); await settle();
		expect(saved).toEqual([]); expect(applied.some(([, , done]) => done)).toBe(false);
		expect(reverted).toEqual(regenerate ? [] : [KEY]); expect(shown[shown.length - 1]).toMatchObject({ kind: 'failed' });
	}
});

it('keeps each video\'s state apart: a job for one video never paints on another', async () => {
	const { gen } = make({ poll: vi.fn(async () => job({ state: 'completed', progress: 100, segments: [{ start: 0, end: 1, text: 'x' }], next: 1 })) });
	gen.actions.confirm(); await settle();
	shown = []; current = OTHER; gen.sync(); expect(shown).toEqual([null]); // another video: nothing shown
	current = KEY; gen.sync(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'generated' }); // back on the first one
	gen.markGenerated(OTHER); current = OTHER; gen.sync(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'generated' });
	current = null; gen.sync(); expect(shown[shown.length - 1]).toBeNull();
});

it('stops watching when the page moves to another video; the job carries on in the helper', async () => {
	const { gen, full } = make({ poll: vi.fn(async () => job()) });
	gen.actions.confirm(); await settle(); const calls = (full.poll as any).mock.calls.length; gen.reset(); await settle();
	expect((full.poll as any).mock.calls.length).toBe(calls); expect(full.cancel).not.toHaveBeenCalled();
});

const lend = (ready: boolean) => vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ready } as never);
it('asks for the browser login only through its own explicit action, and then tells the helper which browser', async () => {
	lend(true);
	const failing = job({ state: 'failed', error: '需要登录', errorCode: 'needs-cookies' });
	const { gen, full } = make({ start: vi.fn(async () => failing) });
	gen.actions.confirm(); await settle();
	expect(full.start).toHaveBeenLastCalledWith(KEY, 'auto'); expect(shown[shown.length - 1]).toEqual({ kind: 'failed', error: '需要登录', code: 'needs-cookies' });
	gen.actions.confirmWithLogin!(); await settle();
	expect(full.start).toHaveBeenLastCalledWith(KEY, 'auto', false, 'chrome');
});

it('passes the spoken language chosen in the confirm step to the helper, and keeps it for a retry with the browser login', async () => {
	lend(true);
	const failing = job({ state: 'failed', error: '需要登录', errorCode: 'needs-cookies' });
	const { gen, full } = make({ start: vi.fn(async () => failing) });
	gen.actions.confirm('en'); await settle(); expect(full.start).toHaveBeenLastCalledWith(KEY, 'en');
	gen.actions.confirmWithLogin!(); await settle(); expect(full.start).toHaveBeenLastCalledWith(KEY, 'en', false, 'chrome');
	gen.actions.confirm(); await settle(); expect(full.start).toHaveBeenLastCalledWith(KEY, 'auto'); // automatic when none was chosen
});

it('tells the confirm step which cloud service the audio would go to, or nothing when the work stays on this computer', async () => {
	const cloud = make({ status: vi.fn(async () => ({ ok: true as const, ready: true, missing: [], hints: [], engine: 'cloud', modelDownloadNeeded: false, mode: 'cloud' as const, cloudLabel: '硅基流动' })) });
	cloud.gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toEqual({ kind: 'confirm', modelDownload: false, cloud: '硅基流动', localService: false });
	const local = make({ status: vi.fn(async () => ({ ok: true as const, ready: true, missing: [], hints: [], engine: 'mlx', modelDownloadNeeded: true, mode: 'local' as const })) });
	local.gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toEqual({ kind: 'confirm', modelDownload: true });
	const unset = make({ status: vi.fn(async () => ({ ok: false as const, error: 'cloud-not-configured' })) });
	unset.gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toEqual({ kind: 'setup', reason: 'cloud-not-configured', hints: [] });
});

const engine = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id + ' model', sizeMb: 1300, note: '', supported: true, installed: true, modelReady: true, managed: true, ...over });
const base = { ok: true as const, ready: true, missing: [] as string[], hints: [], engine: 'mlx' as string | null, modelDownloadNeeded: false };

it('lists local engines and saved cloud services, each with what it costs and where the audio goes, and says what would have to be installed', () => {
	const status = { ...base, local: [engine('mlx', { recommended: true }), engine('mlx-qwen3', { installed: false })], choices: { mode: 'local' as const, engine: 'auto', active: 'a', profiles: [{ id: 'a', label: '智谱', local: false, configured: true }, { id: 'z', label: '空', local: false, configured: false }] } };
	const ui = confirmFor(status);
	expect(ui).toMatchObject({ kind: 'confirm', selected: 'local:mlx' });
	expect(ui.choices).toEqual([
		{ value: 'local:mlx', kind: 'local', label: 'mlx model', note: '本机 · 音频不上传 · 免费' },
		{ value: 'local:mlx-qwen3', kind: 'local', label: 'mlx-qwen3 model', note: '本机 · 音频不上传 · 需先下载 1.3 GB' },
		{ value: 'cloud:a', kind: 'cloud', label: '智谱', note: '云端 · 音频会上传到该服务并按其规则计费' },
	]); expect(ui.install).toBeUndefined();
	const missing = confirmFor({ ...status, ready: false, engine: null, missing: ['whisper'], choices: { ...status.choices, engine: 'mlx-qwen3' }, installable: { base: false, engines: ['mlx-qwen3'] } });
	expect(missing).toMatchObject({ selected: 'local:mlx-qwen3', target: 'mlx-qwen3', install: { name: 'mlx-qwen3 model', sizeMb: 1300 } });
	const tools = confirmFor({ ...status, ready: false, missing: ['yt-dlp', 'ffmpeg'], installable: { base: true, engines: [] } }); expect(tools).toMatchObject({ target: 'base', install: { sizeMb: 60 } });
	const cloud = confirmFor({ ...status, mode: 'cloud', cloudLabel: '智谱', choices: { ...status.choices, mode: 'cloud' } }); expect(cloud).toMatchObject({ cloud: '智谱', selected: 'cloud:a' }); expect(cloud.target).toBeUndefined(); // a cloud service needs no local engine
	expect(viaOf(status)).toBe('mlx model · 本机'); expect(viaOf({ ...status, mode: 'cloud', cloudLabel: '智谱' })).toBe('智谱 · 云端'); expect(viaOf({ ...status, mode: 'cloud', cloudLabel: '本机服务', cloudLocal: true })).toBe('本机服务');
});

it('installs what is missing when the viewer agrees, then carries straight on to the subtitles', async () => {
	const states = [{ state: 'installing', stage: 'pip', progress: 40 }, { state: 'completed', stage: 'done', progress: 100 }];
	const install = vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'mlx-qwen3', state: 'queued' as const, stage: '', progress: 0 }));
	const { gen, full } = make({ install, installPoll: vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'mlx-qwen3', ...states.shift()! } as any)), status: vi.fn(async () => ({ ...base, ready: false, engine: null, missing: ['whisper'], local: [engine('mlx-qwen3', { installed: false, recommended: true })], choices: { mode: 'local' as const, engine: 'auto', active: '', profiles: [] }, installable: { base: false, engines: ['mlx-qwen3'] } })) });
	gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'confirm', install: { name: 'mlx-qwen3 model' } }); expect(install).not.toHaveBeenCalled(); // nothing is installed before the viewer agrees
	gen.actions.confirm('en'); await settle();
	expect(install).toHaveBeenCalledWith('mlx-qwen3'); expect(shown.some(ui => ui?.kind === 'installing')).toBe(true); expect(full.start).toHaveBeenCalledWith(KEY, 'en'); expect(saved).toEqual([[KEY, 1]]);
});

it('shows an install failure with a retry, and switching the engine saves the choice and shows the confirm step again', async () => {
	const failing = make({ install: vi.fn(async () => ({ ok: false as const, error: 'no-space', needMb: 100, freeMb: 1 })), status: vi.fn(async () => ({ ...base, ready: false, engine: null, missing: ['yt-dlp'], installable: { base: true, engines: [] } })) });
	failing.gen.actions.request(); await settle(); failing.gen.actions.confirm(); await settle();
	expect(shown[shown.length - 1]).toMatchObject({ kind: 'failed', code: 'install', error: expect.stringContaining('磁盘空间不足') }); expect(failing.full.start).not.toHaveBeenCalled();
	const choose = vi.fn(async () => ({ ok: true as const } as any)); const status = vi.fn(async () => base); shown = [];
	const picked = make({ status }); const gen2 = createBarGeneration({ videoKey: () => current, bar: () => ({ setGeneration: (ui: GenUi | null) => shown.push(ui) }) as any, apply: () => {}, revert: () => {}, save: () => {}, deps: picked.full, choose, intervalMs: 5 });
	gen2.actions.request(); await settle(); status.mockClear(); gen2.actions.choose!('cloud:abc'); await settle(); expect(choose).toHaveBeenCalledWith({ profile: 'abc', videoKey: KEY }); expect(status).toHaveBeenCalledTimes(1);
	gen2.actions.choose!('local:mlx-qwen3'); await settle(); expect(choose).toHaveBeenLastCalledWith({ engine: 'mlx-qwen3', videoKey: KEY });
});

const ready = (over: Record<string, unknown> = {}) => ({ ...base, local: [engine('mlx', { recommended: true })], choices: { mode: 'local' as const, engine: 'auto', auto: false, active: '', profiles: [] }, ...over });

it('starts at once, without asking, when the viewer has already chosen how and agreed to start straight away', async () => {
	const { gen, full } = make({ status: vi.fn(async () => ready({ choices: { mode: 'local' as const, engine: 'auto', auto: true, active: '', profiles: [] } })) });
	gen.actions.request(); await settle();
	expect(full.start).toHaveBeenCalledTimes(1); expect(shown.some(ui => ui?.kind === 'confirm')).toBe(false); expect(shown.find(ui => ui?.kind === 'running')).toMatchObject({ via: 'mlx model · 本机' });
	expect(shown[shown.length - 1]).toMatchObject({ kind: 'generated', via: 'mlx model · 本机' });
});

it('still asks first when nothing is decided yet, when something must be installed, or when asked to do it another way', async () => {
	let made = make({ status: vi.fn(async () => ready()) }); made.gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'confirm' }); expect(made.full.start).not.toHaveBeenCalled();
	const auto = { mode: 'local' as const, engine: 'auto', auto: true, active: '', profiles: [] };
	made = make({ status: vi.fn(async () => ready({ ready: false, engine: null, missing: ['whisper'], local: [engine('mlx', { installed: false, recommended: true })], installable: { base: false, engines: ['mlx'] }, choices: auto })) });
	made.gen.actions.request(); await settle(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'confirm', install: expect.anything() }); expect(made.full.start).not.toHaveBeenCalled();
	made = make({ status: vi.fn(async () => ready({ choices: auto })) }); made.gen.actions.request(); await settle(); made.full.start = vi.fn(async () => job()) as never;
	made.gen.actions.regenerate!(); await settle(); expect(shown[shown.length - 1]).toMatchObject({ kind: 'confirm' }); // the viewer asked to choose again
});

it('remembers the choice, and the language, when the viewer ticks "start straight away"', async () => {
	const store: Record<string, string> = {}; vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
	const choose = vi.fn(async () => ({ ok: true as const } as any)); const made = make({ status: vi.fn(async () => ready()) });
	const gen = createBarGeneration({ videoKey: () => current, bar: () => ({ setGeneration: (ui: GenUi | null) => shown.push(ui) }) as any, apply: () => {}, revert: () => {}, save: () => {}, deps: made.full, choose, intervalMs: 5 });
	gen.actions.request(); await settle(); gen.actions.confirm('en', true); await settle();
	expect(choose).toHaveBeenCalledWith({ engine: 'mlx', auto: true, videoKey: KEY }); expect(made.full.start).toHaveBeenCalledWith(KEY, 'en'); expect(store.qiaomuAsrLanguage).toBe('en');
	choose.mockClear(); gen.actions.request(); await settle(); gen.actions.confirm('en', false); await settle(); expect(choose).toHaveBeenCalledWith({ engine: 'mlx', auto: false, videoKey: KEY });
});

it('remaking the subtitles keeps the existing lines until the new ones are done, and keeps them if it is cancelled', async () => {
	const { gen, full } = make({ poll: vi.fn(async () => job()) });
	gen.actions.regenerate!(); await settle(); gen.actions.confirm(); await settle();
	expect(full.start).toHaveBeenCalledWith(KEY, 'auto', true); expect(applied).toEqual([]); // nothing painted while it runs
	gen.actions.cancel(); await settle(); expect(reverted).toEqual([]); expect(shown[shown.length - 1]).toMatchObject({ kind: 'generated' });
});

it('sends the viewer to the settings when the permission to use the browser login has not been given yet', async () => {
	lend(false);
	const failing = job({ state: 'failed', error: '需要登录', errorCode: 'needs-cookies' }), openSettings = vi.fn();
	const { gen, full } = make({ start: vi.fn(async () => failing) }, { openSettings });
	gen.actions.confirm(); await settle(); (full.start as ReturnType<typeof vi.fn>).mockClear();
	gen.actions.confirmWithLogin!(); await settle();
	expect(full.start).not.toHaveBeenCalled(); expect(openSettings).toHaveBeenCalled();
	expect(shown[shown.length - 1]).toMatchObject({ kind: 'failed', code: 'cookies-permission' });
});


it('OpenAI only installs the 60 MB base tools and continues without a local model', async () => {
    const install = vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'base', state: 'queued' as const, stage: '', progress: 0 }));
    const { gen, full } = make({ install, installPoll: vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'base', state: 'completed' as const, stage: 'done', progress: 100 })), status: vi.fn(async () => ({ ...base, mode: 'cloud' as const, cloudLabel: 'OpenAI', ready: false, engine: 'cloud', missing: ['yt-dlp', 'ffmpeg'], local: [engine('faster-whisper', { installed: false, sizeMb: 1700, modelReady: false, recommended: true })], choices: { mode: 'cloud' as const, engine: 'faster-whisper', active: 'openai', profiles: [{ id: 'openai', label: 'OpenAI', local: false, configured: true }] }, installable: { base: true, engines: ['faster-whisper'] } })) });
    gen.actions.request(); await settle();
    expect(shown[shown.length - 1]).toMatchObject({ kind: 'confirm', selected: 'cloud:openai', cloud: 'OpenAI', modelDownload: false, install: { sizeMb: 60 } });
    gen.actions.confirm(); await settle();
    expect(install).toHaveBeenCalledExactlyOnceWith('base');
    expect(full.start).toHaveBeenCalledWith(KEY, 'auto');
    expect(saved).toEqual([[KEY, 1]]);
});
