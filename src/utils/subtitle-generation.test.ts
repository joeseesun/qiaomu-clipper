import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGeneration, toLines, type GenerationDeps, type GenerationEvent } from './subtitle-generation';
import type { AsrJob } from './asr-client';

const KEY = 'bilibili:BV1hM4m1U7rA:20', ID = 'a'.repeat(32);
const job = (over: Partial<AsrJob> = {}): AsrJob => ({ ok: true, id: ID, videoKey: KEY, state: 'transcribing', stage: '正在识别语音', progress: 20, segments: [], next: 0, ...over });
const seg = (start: number, text: string) => ({ start, end: start + 2, text });
let events: GenerationEvent[];
const make = (deps: Partial<GenerationDeps>) => {
	const full: GenerationDeps = { status: vi.fn(async () => ({ ok: true as const, ready: true, missing: [], hints: [], engine: 'mlx', modelDownloadNeeded: false })), start: vi.fn(async () => job()), poll: vi.fn(async () => job()), cancel: vi.fn(async () => job({ state: 'cancelled' })), ...deps };
	return { full, generation: createGeneration(event => events.push(event), full, 10) };
};
const settle = async () => { for (let i = 0; i < 30; i++) { await vi.advanceTimersByTimeAsync(10); } };
beforeEach(() => { events = []; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it('turns helper segments into transcript lines with clock stamps', () => {
	expect(toLines([seg(0, 'a'), seg(95.9, 'b'), seg(3725, 'c')])).toEqual([{ time: '0:00', text: 'a' }, { time: '1:35', text: 'b' }, { time: '1:02:05', text: 'c' }]);
});

it('streams new lines as they are polled and ends with the finished transcript', async () => {
	const polls = [job({ segments: [seg(0, '你好')], next: 1, progress: 30, processedSec: 12, totalSec: 120 }), job({ segments: [seg(4, '世界')], next: 2, progress: 60 }), job({ state: 'completed', stage: '字幕已生成', progress: 100, segments: [seg(8, '再见')], next: 3, language: 'zh' })];
	const { full, generation } = make({ poll: vi.fn(async () => polls.shift()!) });
	generation.run(KEY); await settle();
	const running = events.filter(e => e.phase === 'running') as Extract<GenerationEvent, { phase: 'running' }>[];
	expect(running.map(e => e.segments.length)).toEqual([0, 1, 2]); expect(running[1].processedSec).toBe(12); expect(running[1].totalSec).toBe(120);
	const done = events[events.length - 1] as Extract<GenerationEvent, { phase: 'done' }>;
	expect(done.phase).toBe('done'); expect(done.segments.map(s => s.text)).toEqual(['你好', '世界', '再见']); expect(done.language).toBe('zh');
	expect(full.poll).toHaveBeenNthCalledWith(1, ID, 0); expect(full.poll).toHaveBeenNthCalledWith(2, ID, 1); expect(generation.active).toBe(false);
});

it('shows a cached result at once without polling', async () => {
	const { full, generation } = make({ start: vi.fn(async () => job({ state: 'completed', cached: true, progress: 100, segments: [seg(0, '缓存'), seg(3, '内容')], next: 2, language: 'zh' })) });
	generation.run(KEY); await settle();
	expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ phase: 'done', cached: true }); expect(full.poll).not.toHaveBeenCalled();
});

it('asks for setup when the helper is missing, outdated, lacks tools or is busy, and fails plainly otherwise', async () => {
	for (const error of ['helper-offline', 'helper-outdated', 'busy'] as const) {
		events = []; make({ start: vi.fn(async () => ({ ok: false as const, error })) }).generation.run(KEY); await settle();
		expect(events[0]).toMatchObject({ phase: 'needs-setup', reason: error });
	}
	events = []; make({ start: vi.fn(async () => ({ ok: false as const, error: 'missing', missing: ['yt-dlp'], hints: ['brew install yt-dlp ffmpeg'] })) }).generation.run(KEY); await settle();
	expect(events[0]).toMatchObject({ phase: 'needs-setup', reason: 'missing', missing: ['yt-dlp'], hints: ['brew install yt-dlp ffmpeg'] });
	events = []; make({ start: vi.fn(async () => ({ ok: false as const, error: 'bad-request' })) }).generation.run(KEY); await settle();
	expect(events[0]).toMatchObject({ phase: 'failed', error: 'bad-request' });
});

it('prepare() reports what is missing and only returns a status when generation can start', async () => {
	expect(await make({}).generation.prepare()).toMatchObject({ ready: true });
	events = []; expect(await make({ status: vi.fn(async () => ({ ok: true as const, ready: false, missing: ['ffmpeg'], hints: ['brew install ffmpeg'], engine: null, modelDownloadNeeded: false })) }).generation.prepare()).toBeUndefined();
	expect(events[0]).toMatchObject({ phase: 'needs-setup', reason: 'missing', missing: ['ffmpeg'] });
	events = []; expect(await make({ status: vi.fn(async () => ({ ok: false as const, error: 'helper-outdated' })) }).generation.prepare()).toBeUndefined();
	expect(events[0]).toMatchObject({ phase: 'needs-setup', reason: 'helper-outdated' });
});

it('reports a failed job with the lines it did get, and a lost connection only after several misses', async () => {
	const { generation } = make({ poll: vi.fn(async () => job({ state: 'failed', error: '音频下载失败', segments: [seg(0, '一半')], next: 1 })) });
	generation.run(KEY); await settle();
	expect(events[events.length - 1]).toMatchObject({ phase: 'failed', error: '音频下载失败', segments: [{ text: '一半' }] });
	events = []; const poll = vi.fn(async () => ({ ok: false as const, error: 'helper-offline' }));
	make({ poll }).generation.run(KEY); await settle();
	expect(poll).toHaveBeenCalledTimes(4); expect(events[events.length - 1]).toMatchObject({ phase: 'failed' });
	events = []; const flaky = [{ ok: false as const, error: 'helper-offline' }, job({ state: 'completed', progress: 100, segments: [seg(0, 'x')], next: 1 })];
	make({ poll: vi.fn(async () => flaky.shift()!) }).generation.run(KEY); await settle();
	expect(events[events.length - 1]).toMatchObject({ phase: 'done' });
});

it('cancel asks the helper to stop and stops polling; dispose only stops watching', async () => {
	const { full, generation } = make({}); generation.run(KEY); await settle();
	const before = (full.poll as any).mock.calls.length; generation.cancel(); await settle();
	expect(full.cancel).toHaveBeenCalledWith(ID); expect((full.poll as any).mock.calls.length).toBe(before); expect(events[events.length - 1]).toMatchObject({ phase: 'cancelled' });
	const second = make({}); second.generation.run(KEY); await settle(); second.generation.dispose(); const calls = (second.full.poll as any).mock.calls.length; await settle();
	expect(second.full.cancel).not.toHaveBeenCalled(); expect((second.full.poll as any).mock.calls.length).toBe(calls); // the job carries on in the helper
});

it('ignores late replies from a run that was replaced', async () => {
	const releases: Array<(value: AsrJob) => void> = [];
	const { generation } = make({ start: vi.fn(() => new Promise<AsrJob>(resolve => { releases.push(resolve); })) });
	generation.run(KEY); generation.run('youtube:dbqweBCynuI'); await settle();
	releases[0](job({ state: 'completed', progress: 100, segments: [seg(0, '旧的')], next: 1 })); await settle();
	expect(events.some(e => e.phase === 'done')).toBe(false); // the first run's answer arrived after it was replaced
	releases[1](job({ state: 'completed', progress: 100, segments: [seg(0, '新的')], next: 1 })); await settle();
	expect(events.filter(e => e.phase === 'done')).toHaveLength(1); expect((events.find(e => e.phase === 'done') as any).segments[0].text).toBe('新的');
});

it('passes a borrowed-login request on to the helper only when one was made, and reports the failure code', async () => {
	const { full, generation } = make({}); generation.run(KEY); await settle(); expect(full.start).toHaveBeenLastCalledWith(KEY, 'auto'); // by default no login is involved
	generation.dispose(); events = [];
	const second = make({ start: vi.fn(async () => job({ state: 'failed', error: '需要登录', errorCode: 'needs-cookies' })) });
	second.generation.run(KEY); await settle(); expect(events[events.length - 1]).toMatchObject({ phase: 'failed', code: 'needs-cookies' });
	second.generation.run(KEY, { cookies: 'chrome' }); await settle(); expect(second.full.start).toHaveBeenLastCalledWith(KEY, 'auto', false, 'chrome');
});

it('installs a missing engine, reporting progress, and says when it is ready', async () => {
	const states = [{ state: 'installing', stage: '正在安装 pip', progress: 30 }, { state: 'downloadingModel', stage: '正在下载识别模型', progress: 70 }, { state: 'completed', stage: '安装完成', progress: 100 }];
	const install = vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'mlx-qwen3', state: 'queued' as const, stage: '正在准备', progress: 0 }));
	const installPoll = vi.fn(async () => ({ ok: true as const, jobId: 'i'.repeat(32), engine: 'mlx-qwen3', ...states.shift()! } as any));
	const { generation } = make({ install, installPoll }); generation.install('mlx-qwen3'); await settle();
	expect(install).toHaveBeenCalledWith('mlx-qwen3'); expect(events.map(e => e.phase)).toEqual(['installing', 'installing', 'installing', 'installed']); expect(generation.active).toBe(false);
});

it('explains why an install could not start or failed, and can cancel one in progress', async () => {
	let made = make({ install: vi.fn(async () => ({ ok: false as const, error: 'no-space', needMb: 2900, freeMb: 800 })) }); made.generation.install('mlx'); await settle();
	expect(events[events.length - 1]).toEqual({ phase: 'install-failed', error: '磁盘空间不足：需要约 2900 MB，现有 800 MB' }); events = [];
	made = make({ install: vi.fn(async () => ({ ok: false as const, error: 'busy', engine: 'mlx' } as any)) }); made.generation.install('mlx'); await settle(); expect(events[0]).toMatchObject({ phase: 'install-failed', error: expect.stringContaining('另一个') }); events = [];
	made = make({ install: vi.fn(async () => ({ ok: true as const, jobId: 'j'.repeat(32), engine: 'x', state: 'failed' as const, stage: '失败', progress: 0, error: '安装失败：no network' })) }); made.generation.install('faster-whisper'); await settle(); expect(events[0]).toEqual({ phase: 'install-failed', error: '安装失败：no network' }); events = [];
	const cancel = vi.fn(async () => ({ ok: true as const, jobId: 'k'.repeat(32), engine: 'x', state: 'cancelled' as const, stage: '', progress: 0 }));
	made = make({ install: vi.fn(async () => ({ ok: true as const, jobId: 'k'.repeat(32), engine: 'x', state: 'installing' as const, stage: 's', progress: 5 })), installPoll: vi.fn(async () => ({ ok: true as const, jobId: 'k'.repeat(32), engine: 'x', state: 'installing' as const, stage: 's', progress: 6 })), installCancel: cancel });
	made.generation.install('mlx'); await settle(); made.generation.cancel(); await settle(); expect(cancel).toHaveBeenCalledWith('k'.repeat(32)); expect(events[events.length - 1]).toEqual({ phase: 'install-cancelled' });
});

it('hands a status that is not ready but installable back to the caller, and still treats an uninstallable gap as setup', async () => {
	const notReady = { ok: true as const, ready: false, missing: ['whisper'], hints: ['x'], engine: null, modelDownloadNeeded: false };
	let made = make({ status: vi.fn(async () => ({ ...notReady, installable: { base: false, engines: ['mlx'] } })) }); expect(await made.generation.prepare()).toMatchObject({ ready: false }); expect(events).toEqual([]);
	made = make({ status: vi.fn(async () => notReady) }); expect(await made.generation.prepare()).toBeUndefined(); expect(events[0]).toMatchObject({ phase: 'needs-setup', reason: 'missing' });
});

it('recovers the original task from all captions at cursor zero without status checks or starting another job', async () => {
 const { full, generation } = make({
  poll: vi.fn().mockResolvedValueOnce(job({segments:[seg(0,'已生成')],next:1})).mockResolvedValueOnce(job({state:'completed',segments:[seg(4,'后来生成')],next:2})),
 });
 generation.run(KEY, {jobId:ID}); await settle();
 expect(full.start).not.toHaveBeenCalled(); expect(full.status).not.toHaveBeenCalled();
 expect(full.poll).toHaveBeenNthCalledWith(1, ID, 0); expect(full.poll).toHaveBeenNthCalledWith(2, ID, 1);
 expect(events[events.length - 1]).toMatchObject({phase:'done',segments:[{text:'已生成'},{text:'后来生成'}]});
});
it.each(['failed','cancelled','unknown-job','offline','wrong-source','wrong-id'])('recovery of a %s task never starts a replacement', async result => {
 const reply = result === 'unknown-job' ? {ok:false,error:'unknown-job'} : result === 'offline' ? {ok:false,error:'helper-offline'}
  : job({state:result === 'failed' ? 'failed' : result === 'cancelled' ? 'cancelled' : 'completed',error:'timeout',videoKey:result === 'wrong-source' ? 'file:'+'b'.repeat(32) : KEY,id:result === 'wrong-id' ? 'b'.repeat(32) : ID});
 const {full,generation} = make({poll:vi.fn().mockResolvedValue(reply)});
 generation.run(KEY,{jobId:ID}); await settle();
 expect(full.start).not.toHaveBeenCalled(); expect(full.poll).toHaveBeenCalledExactlyOnceWith(ID,0);
 expect(events[events.length - 1]?.phase).toBe(result === 'cancelled' ? 'cancelled' : 'failed');
});
it('disposing recovery ignores a late result and leaves the original background task running', async () => {
 let resolve!: (value:AsrJob)=>void;
 const {full,generation} = make({poll:vi.fn(()=>new Promise<AsrJob>(r=>{resolve=r;}))});
 generation.run(KEY,{jobId:ID}); generation.dispose(); resolve(job({state:'completed'})); await settle();
 expect(events).toEqual([]); expect(full.start).not.toHaveBeenCalled(); expect(full.cancel).not.toHaveBeenCalled();
});
