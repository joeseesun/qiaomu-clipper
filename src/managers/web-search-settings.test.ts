// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ save: vi.fn(), search: vi.fn() }));
vi.mock('../utils/web-search', () => ({ loadWebSearch: async () => ({ enabled: true, provider: 'deepseek', keys: { deepseek: 'existing', brave: '' } }), saveWebSearch: (...a: any[]) => state.save(...a), searchWeb: (...a: any[]) => state.search(...a), searchFailure: (e: Error) => e.message }));
import { openWebSearchSettings } from './web-search-settings';
beforeEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); HTMLDialogElement.prototype.showModal = function() { this.open = true; }; HTMLDialogElement.prototype.close = function() { this.open = false; }; state.search.mockResolvedValue([{ title:'OK' }]); state.save.mockResolvedValue(undefined); });
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === name)!;
it('verifies and saves only the chosen provider while preserving previously saved keys', async () => {
 const saved=vi.fn(); await openWebSearchSettings(saved);
 const key=document.querySelector<HTMLInputElement>('input[type=password]')!, service=document.querySelector('select')!;
 key.value='unverified-change'; service.value='brave'; service.dispatchEvent(new Event('change')); key.value='new-brave'; button('验证并保存').click();
 await vi.waitFor(() => expect(saved).toHaveBeenCalled());
 expect(state.search.mock.calls[0][1].provider).toBe('brave'); expect(state.save.mock.calls[0][0].keys).toEqual({ deepseek:'existing', brave:'new-brave' }); expect(document.querySelector('dialog')).toBeNull();
});
it('retains the dialog and previous settings after a failed verification', async () => {
 state.search.mockRejectedValue(new Error('HTTP 401')); await openWebSearchSettings(); button('验证并保存').click();
 await vi.waitFor(() => expect(document.querySelector('[role=status]')!.textContent).toBe('HTTP 401'));
 expect(state.save).not.toHaveBeenCalled(); expect(document.querySelector('dialog')).not.toBeNull();
});
it('closing during verification aborts and cannot save a late result', async () => {
 let finish!: (v:any)=>void;state.search.mockImplementation(()=>new Promise(r=>finish=r));await openWebSearchSettings(); button('验证并保存').click(); const signal=state.search.mock.calls[0][2];button('取消').click();finish([{title:'late'}]);await Promise.resolve();await Promise.resolve();expect(signal.aborted).toBe(true);expect(state.save).not.toHaveBeenCalled();
});
