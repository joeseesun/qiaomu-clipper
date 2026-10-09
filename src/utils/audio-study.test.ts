// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, any>, messages: [] as any[], active: 'sf', failChoice: false, failCache: false, job: {} as any, upload: vi.fn(), release: vi.fn(), populate: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: {
	i18n: { getMessage: () => '' }, runtime: { getURL: (path: string) => 'chrome-extension://fixture/' + path, sendMessage: async (message: any) => {
		state.messages.push(message); const p = message.payload;
		if (!p) return {};
		if (p.mode === 'choose') { if (state.failChoice) return { ok: false, error: 'helper-offline' }; if (p.profile) state.active = p.profile; }
		if (p.mode === 'status' || p.mode === 'choose') return {
			ok: true, ready: true, missing: [], hints: [], engine: 'cloud', mode: 'cloud', modelDownloadNeeded: false,
			cloudLabel: state.active === 'sf' ? '硅基流动' : '智谱', cloudModel: state.active === 'sf' ? 'Qwen/Qwen3-ASR-1.7B' : 'glm-asr-2512',
			local: [{ id: 'faster-whisper', name: 'Whisper', supported: true, installed: false, managed: true, sizeMb: 1700 }],
			choices: { mode: 'cloud', engine: 'faster-whisper', active: state.active, auto: true, profiles: [{ id: 'sf', label: '硅基流动', model: 'Qwen/Qwen3-ASR-1.7B', configured: true, local: false }, { id: 'glm', label: '智谱', model: 'glm-asr-2512', configured: true, local: false }] },
		};
		if (p.mode === 'start' || p.mode === 'poll') return state.job;
		return { ok: true };
	} }, storage: { local: {
		get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: any) => {
			if (state.failCache) throw new Error('full');
			const clone = JSON.parse(JSON.stringify(value));
			for (const item of Object.values(clone) as any[]) if (item.segments) item.segments = item.segments.map((line: any) => Object.fromEntries(Object.entries(line).sort(([a], [b]) => a.localeCompare(b))));
			Object.assign(state.store, clone);
		}, remove: async () => {},
	} },
} }));
vi.mock('./asr-client', async importOriginal => ({ ...await importOriginal<typeof import('./asr-client')>(), asrUpload: state.upload }));
vi.mock('./file-handoff', () => ({ releaseHandedFile: state.release }));
vi.mock('./reader', () => ({ Reader: {
	apply: vi.fn(async () => { document.body.innerHTML = '<main><h1>File</h1><article></article></main>'; }),
	attachYouTubeTranscript: vi.fn(async (_doc: Document, transcript: HTMLElement) => { document.querySelector('article')!.append(transcript); }),
} }));
vi.mock('./highlighter', () => ({ setPageUrl: vi.fn(), setPageTitle: vi.fn() }));
vi.mock('./reader-source-draft', () => ({ createReaderSourceDraft: async () => ({ draft: {}, populate: state.populate }) }));
vi.mock('./reader-preview-shell', () => ({ mountReaderPreviewShell: () => ({ chat: {}, refresh: vi.fn(), setPending: vi.fn() }) }));
vi.mock('./page-reload', () => ({ reloadPage: vi.fn() }));
import { startAudioStudy } from './audio-study';
import { reloadPage } from './page-reload';
const KEY = 'file:' + 'a'.repeat(32), TOKEN = 'b'.repeat(24);
const cached = () => state.store['qiaomuTranscript2:generated:' + KEY]?.segments;
const job = (text = '完整字幕', extra = {}) => ({ ok: true, id: 'c'.repeat(32), videoKey: KEY, state: 'completed', stage: '', progress: 100, next: 1, segments: [{ start: 0, end: 2, text }], ...extra });
const flush = async () => { for (let n = 0; n < 45; n++) await Promise.resolve(); };
const press = async (selector: string) => { document.querySelector<HTMLButtonElement>(selector)!.click(); await flush(); };
beforeEach(() => {
	vi.clearAllMocks(); state.store = {}; state.messages = []; state.active = 'sf'; state.failChoice = false; state.failCache = false;
	state.job = job(); state.upload.mockResolvedValue({ ok: true, key: KEY }); state.release.mockResolvedValue(undefined); state.populate.mockResolvedValue(undefined);
	sessionStorage.clear(); document.body.innerHTML = ''; vi.stubGlobal('CSS', {});
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows provider and actual model before selecting a file, using shared cloud choices without leaking keys', async () => {
	await startAudioStudy({ kind: 'file' });
	expect(document.querySelector('.qiaomu-file-recognizer')?.textContent).toContain('硅基流动');
	expect(document.querySelector('.qiaomu-file-recognizer')?.textContent).toContain('Qwen/Qwen3-ASR-1.7B');
	expect(state.upload).not.toHaveBeenCalled(); expect(state.messages.some(m => m.payload?.mode === 'start')).toBe(false);
	const picker = document.querySelector<HTMLSelectElement>('.qiaomu-file-recognizer select')!;
	expect(picker.value).toBe('cloud:sf'); picker.value = 'cloud:glm'; picker.dispatchEvent(new Event('change')); await flush();
	expect(state.messages).toContainEqual({ action:'qiaomuAsr', payload:{ mode:'choose', profile:'glm', videoKey:'file:'+'0'.repeat(32) } });
	expect(document.querySelector('.qiaomu-file-recognizer')?.textContent).toContain('glm-asr-2512');
	expect(document.body.textContent).toContain('计费'); expect(document.body.textContent).not.toContain('API Key');
});
it('uploads the handoff once, acknowledges only success, and asks before cloud recognition despite auto-start', async () => {
	await startAudioStudy({ kind:'file', file:new File(['video'], 'lecture.mp4'), token:TOKEN }); await flush();
	expect(state.release).toHaveBeenCalledExactlyOnceWith(TOKEN);
	expect(state.messages.some(m => m.payload?.mode === 'start')).toBe(false);
	expect(document.querySelector('.qiaomu-dlg-wrap')?.textContent).toContain('Qwen/Qwen3-ASR-1.7B');
	expect(document.querySelector('.qiaomu-dlg-wrap')?.textContent).not.toContain('1700'); // cloud needs no Whisper download
	await press('.qiaomu-dlg-btn.is-primary');
	expect(document.querySelector('.transcript')?.textContent).toContain('完整字幕'); expect(cached()).toHaveLength(1);
	expect(document.title).toBe('lecture'); expect(reloadPage).not.toHaveBeenCalled();
	expect(document.querySelector('.qiaomu-audio-status')?.textContent).not.toContain('未保存');
});
it('replaces a cached transcript after changing model while retaining the exact player and playback state', async () => {
	state.store['qiaomuTranscript2:generated:' + KEY] = { segments:[{time:'0:00', text:'旧字幕'}] };
	await startAudioStudy({ kind:'file', file:new File(['video'], 'lecture.mp4'), token:TOKEN }); await flush();
	const player = document.querySelector('video')!; player.currentTime = 42; player.playbackRate = 1.5;
	await press('.qiaomu-yt-gen[data-kind=generated] button');
	await press('.qiaomu-dlg-choice[data-value="cloud:glm"]');
	state.job = job('新模型完整字幕'); await press('.qiaomu-dlg-btn.is-primary');
	expect(document.querySelectorAll('.transcript')).toHaveLength(1);
	expect(document.querySelector('.transcript')?.textContent).toContain('新模型完整字幕');
	expect(document.querySelector('.transcript')?.textContent).not.toContain('旧字幕');
	expect(document.querySelector('video')).toBe(player); expect(player.currentTime).toBe(42); expect(player.playbackRate).toBe(1.5);
	expect(state.messages.find(m => m.payload?.mode === 'start')?.payload.force).toBe(true);
	expect(cached()[0].text).toBe('新模型完整字幕'); expect(reloadPage).not.toHaveBeenCalled();
	expect(document.querySelector('.qiaomu-audio-status')?.textContent).not.toContain('未保存');
});
it('restores title and complete captions after the raw handoff was consumed; reselect explicitly restores playback', async () => {
	await startAudioStudy({ kind:'file', file:new File(['video'], 'lecture.mp4'), token:TOKEN }); await flush();
	await press('.qiaomu-dlg-btn.is-primary'); window.dispatchEvent(new Event('pagehide'));
	await startAudioStudy({ kind:'file', token:TOKEN });
	expect(document.title).toBe('lecture'); expect(document.querySelector('.transcript')?.textContent).toContain('完整字幕');
	expect(document.querySelector('.qiaomu-audio-chooser')?.textContent).toContain('重新选择同一文件');
	expect(state.upload).toHaveBeenCalledTimes(1); expect(document.querySelector('video')).toBeNull();
	const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
	Object.defineProperty(input, 'files', { value:[new File(['video'], 'lecture.mp4')] }); input.dispatchEvent(new Event('change')); await flush();
	expect(document.querySelector('video')).not.toBeNull(); expect(document.querySelectorAll('.transcript')).toHaveLength(1);
	expect(state.messages.filter(m => m.payload?.mode === 'start')).toHaveLength(1); // no second charged recognition
});
it('makes failed and thrown uploads visible with retry, retaining the handoff and avoiding duplicate uploads', async () => {
	state.upload.mockResolvedValueOnce({ok:false,error:'no-space'});
	await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4'),token:TOKEN});
	expect(state.release).not.toHaveBeenCalled(); expect(document.querySelector('.qiaomu-audio-status')?.textContent).toContain('磁盘空间不足');
	state.upload.mockRejectedValueOnce(new Error('read failed'));
	await press('.qiaomu-audio-chooser button:last-child'); expect(document.querySelector('.qiaomu-audio-status')?.textContent).toContain('read failed');
	await press('.qiaomu-audio-chooser button:last-child'); expect(state.release).toHaveBeenCalledOnce();
	expect(document.querySelectorAll('video')).toHaveLength(1);
});
it('retains a successful displayed result when browser cache writes fail, and says that recognition succeeded', async () => {
	state.failCache = true;
	await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4')}); await flush(); await press('.qiaomu-dlg-btn.is-primary');
	expect(document.querySelector('.transcript')?.textContent).toContain('完整字幕');
	expect(document.querySelector('.qiaomu-audio-status')?.textContent).toContain('识别已成功');
	expect(document.querySelector('.qiaomu-yt-gen')?.getAttribute('data-kind')).toBe('generated'); expect(reloadPage).not.toHaveBeenCalled();
});
it('keeps an old complete result on failed regeneration and never caches partial failed output', async () => {
	state.store['qiaomuTranscript2:generated:' + KEY] = { segments:[{time:'0:00',text:'旧完整字幕'}] };
	await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4')});
	await press('.qiaomu-yt-gen[data-kind=generated] button'); state.job = job('部分', {state:'failed',error:'cloud failed'}); await press('.qiaomu-dlg-btn.is-primary');
	expect(document.querySelector('.qiaomu-yt-gen')?.textContent).toContain('cloud failed');
	expect(document.querySelector('.transcript')?.textContent).toContain('旧完整字幕'); expect(cached()[0].text).toBe('旧完整字幕');
});
it('shows a missing handoff and a failed model switch instead of returning an unexplained blank page', async () => {
	await startAudioStudy({kind:'file',token:TOKEN});
	expect(document.querySelector('.qiaomu-audio-status')?.textContent).toContain('文件交接已过期');
	state.failChoice = true; const picker = document.querySelector<HTMLSelectElement>('.qiaomu-file-recognizer select')!;
	picker.value='cloud:glm'; picker.dispatchEvent(new Event('change')); await flush();
	expect(document.querySelector('.qiaomu-file-recognizer')?.textContent).toContain('切换识别方式失败'); expect(state.active).toBe('sf');
});
it('rejoins a confirmed in-flight helper job after refresh without forcing a second recognition', async () => {
	state.job=job('partial',{state:'transcribing',progress:10});
	await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4')});await flush();await press('.qiaomu-dlg-btn.is-primary');
	expect(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!).pending).toBe(true);
	window.dispatchEvent(new Event('pagehide'));
	state.job=job('后台完成的完整字幕');await startAudioStudy({kind:'file',token:TOKEN});await flush();
	expect(document.querySelector('.transcript')?.textContent).toContain('后台完成的完整字幕');
	const starts=state.messages.filter(m=>m.payload?.mode==='start');expect(starts).toHaveLength(1);expect(state.messages).toContainEqual({action:'qiaomuAsr',payload:{mode:'poll',jobId:'c'.repeat(32),since:0}});
	expect(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!).pending).toBe(false);
});
it('cancels a remake without losing the previous success or resuming the cancelled job after reload', async () => {
	state.store['qiaomuTranscript2:generated:' + KEY]={segments:[{time:'0:00',text:'原完整字幕'}]};
	await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4')});
	await press('.qiaomu-yt-gen[data-kind=generated] button');state.job=job('partial',{state:'transcribing'});await press('.qiaomu-dlg-btn.is-primary');
	expect(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!).pending).toBe(true);
	await press('.qiaomu-yt-gen[data-kind=running] button');
	expect(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!).pending).toBe(false);
	expect(document.querySelector('.transcript')?.textContent).toContain('原完整字幕');
});

it.each(['failed', 'cancelled', 'unknown-job'])('refresh only observes the original task when it is %s; retry needs confirmation', async result => {
 state.job = job('partial', {state:'transcribing',progress:10});
 await startAudioStudy({kind:'file',file:new File(['video'],'lecture.mp4')}); await flush(); await press('.qiaomu-dlg-btn.is-primary');
 expect(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!).jobId).toBe('c'.repeat(32));
 window.dispatchEvent(new Event('pagehide'));
 state.job = result === 'unknown-job' ? {ok:false,error:'unknown-job'} : job('', {state:result,segments:[],next:0,error:'cloud timeout'});
 await startAudioStudy({kind:'file',token:TOKEN}); await flush();
 expect(state.messages.filter(m => m.payload?.mode === 'start')).toHaveLength(1);
 expect(state.messages).toContainEqual({action:'qiaomuAsr',payload:{mode:'poll',jobId:'c'.repeat(32),since:0}});
 await press('.qiaomu-yt-gen button');
 expect(state.messages.filter(m => m.payload?.mode === 'start')).toHaveLength(1);
 expect(document.querySelector('.qiaomu-dlg-wrap')).not.toBeNull();
});
it('asks again if a refresh happens before the helper returned a task ID', async () => {
 sessionStorage.setItem('qiaomuFileStudySession', JSON.stringify({route:window.location.href,key:KEY,title:'lecture',at:Date.now(),pending:true}));
 await startAudioStudy({kind:'file',token:TOKEN}); await flush();
 expect(state.messages.some(m => m.payload?.mode === 'start')).toBe(false);
 expect(document.querySelector('.qiaomu-dlg-wrap')).not.toBeNull();
});
