// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ save: vi.fn(), search: vi.fn(), config: undefined as any }));
vi.mock('../utils/web-search', () => ({ loadWebSearch: async () => state.config ?? ({ enabled: true, provider: 'deepseek', keys: { deepseek: 'existing', brave: '', keenable: '' } }), saveWebSearch: (...a: any[]) => state.save(...a), searchWeb: (...a: any[]) => state.search(...a), searchFailure: (e: Error) => e.message }));
import { openWebSearchSettings, initializeWebSearchSettings } from './web-search-settings';
beforeEach(() => { vi.clearAllMocks(); state.config = undefined; document.body.replaceChildren(); HTMLDialogElement.prototype.showModal = function() { this.open = true; }; HTMLDialogElement.prototype.close = function() { this.open = false; }; state.search.mockResolvedValue([{ title:'OK' }]); state.save.mockResolvedValue(undefined); });
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === name)!;
it('verifies and saves only the chosen provider while preserving previously saved keys', async () => {
 const saved=vi.fn(); await openWebSearchSettings(saved);
 const key=document.querySelector<HTMLInputElement>('input[type=password]')!, service=document.querySelector('select')!;
 key.value='unverified-change'; service.value='brave'; service.dispatchEvent(new Event('change')); key.value='new-brave'; button('验证并保存').click();
 await vi.waitFor(() => expect(saved).toHaveBeenCalled());
 expect(state.search.mock.calls[0][1].provider).toBe('brave'); expect(state.save.mock.calls[0][0].keys).toEqual({ deepseek:'existing', brave:'new-brave', keenable:'' }); expect(document.querySelector('dialog')).toBeNull();
});
it('saves Keenable without a key after a keyless verification and keeps other keys', async () => {
 const saved=vi.fn(); await openWebSearchSettings(saved);
 const key=document.querySelector<HTMLInputElement>('input[type=password]')!, service=document.querySelector('select')!;
 expect(Array.from(service.options).map(o => o.textContent)).toEqual(['DeepSeek Search', 'Brave Search', 'Keenable']); expect(service.value).toBe('deepseek');
 service.value='keenable'; service.dispatchEvent(new Event('change')); expect(key.value).toBe(''); expect(key.placeholder).toBe('API Key（可选）'); button('验证并保存').click();
 await vi.waitFor(() => expect(saved).toHaveBeenCalled());
 expect(state.search.mock.calls[0][1]).toMatchObject({ provider: 'keenable', keys: { deepseek:'existing', brave:'', keenable:'' } }); expect(state.save.mock.calls[0][0].provider).toBe('keenable');
});
it('lists keyless Keenable as connected only while it is the chosen service', async () => {
 document.body.append(Object.assign(document.createElement('div'), { id: 'web-search-home' }));
 state.config = { enabled: true, provider: 'keenable', keys: { deepseek: 'existing', brave: '', keenable: '' } }; await initializeWebSearchSettings();
 expect(document.querySelectorAll('#web-search-home p')[1].textContent).toBe('DeepSeek Search · Keenable (默认)');
 state.config = { enabled: true, provider: 'deepseek', keys: { deepseek: 'existing', brave: '', keenable: '' } }; await initializeWebSearchSettings();
 expect(document.querySelectorAll('#web-search-home p')[1].textContent).toBe('DeepSeek Search (默认)');
});
it('retains the dialog and previous settings after a failed verification', async () => {
 state.search.mockRejectedValue(new Error('HTTP 401')); await openWebSearchSettings(); button('验证并保存').click();
 await vi.waitFor(() => expect(document.querySelector('[role=status]')!.textContent).toBe('HTTP 401'));
 expect(state.save).not.toHaveBeenCalled(); expect(document.querySelector('dialog')).not.toBeNull();
});
it('closing during verification aborts and cannot save a late result', async () => {
 let finish!: (v:any)=>void;state.search.mockImplementation(()=>new Promise(r=>finish=r));await openWebSearchSettings(); button('验证并保存').click(); const signal=state.search.mock.calls[0][2];button('取消').click();finish([{title:'late'}]);await Promise.resolve();await Promise.resolve();expect(signal.aborted).toBe(true);expect(state.save).not.toHaveBeenCalled();
});
