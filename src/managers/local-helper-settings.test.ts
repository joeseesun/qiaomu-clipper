// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ outdated: true, offline: false, send: vi.fn() }));
vi.mock('../utils/browser-polyfill', () => ({ default: {
 runtime: { id: 'fixture', getURL: (p: string) => p, sendMessage: state.send },
 storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
} }));
vi.mock('../utils/storage-utils', () => ({ generalSettings: { vaults: [] }, loadSettings: vi.fn(), saveSettings: vi.fn(), setLocalStorage: vi.fn(), getLocalStorage: vi.fn() }));
import { initializeLocalVaultSettings } from './general-settings';
import { setLocalStorage } from '../utils/storage-utils';
const el = (id: string) => document.getElementById(id)!;
beforeEach(() => {
 document.body.innerHTML = readFileSync('src/settings.html', 'utf8');
 vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
 state.outdated = true; state.offline = false; state.send.mockReset();
 vi.mocked(setLocalStorage).mockClear();
 state.send.mockImplementation(async (m: any) => m.action === 'qiaomuAsr' ? state.outdated ? {ok:false,error:'helper-outdated'} : {ok:true} : m.action === 'qiaomuLocalStatus' ? state.offline ? {ok:false,reason:'Specified native messaging host not found.'} : {ok:true} : {ok:true,vaults:[]});
});

it('persists a picked folder before remembering it and restores the previous selection if persistence fails', async () => {
 let active='/vault/Old', reject=false;
 state.send.mockImplementation(async (m:any) => {
  if(m.action==='qiaomuLocalStatus') return {ok:true,vault:'Old',vaultPath:active};
  if(m.action==='qiaomuLocalChooseVault') return {ok:true,vault:'New',vaultPath:'/vault/New'};
  if(m.action==='qiaomuLocalConfigure') {if(reject) return {ok:false,error:'disk full'};active=m.payload.vaultPath;return {ok:true,vault:'New',vaultPath:active};}
  return {ok:true,vaults:[]};
 });
 await initializeLocalVaultSettings();
 const select=el('local-vault-select') as HTMLSelectElement;
 reject=true;select.value='__other__';select.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(select.disabled).toBe(false));
 expect(select.value).toBe('/vault/Old');expect(el('local-vault-status').textContent).toBe('disk full');
 expect(setLocalStorage).not.toHaveBeenCalledWith('lastSelectedVault','New');
 reject=false;select.value='__other__';select.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(select.value).toBe('/vault/New'));
 expect(setLocalStorage).toHaveBeenCalledWith('lastSelectedVault','New');
 expect(state.send.mock.calls.filter(([m])=>m.action==='qiaomuLocalConfigure')).toHaveLength(2);
});
afterEach(() => vi.restoreAllMocks());
it('keeps the pkg visible when saving connects but subtitle support needs an update, and rechecks after installation', async () => {
 await initializeLocalVaultSettings();
 expect(el('local-helper-note').textContent).toContain('需要更新');
 expect(el('local-helper-help').hidden).toBe(false);
 expect(el('local-helper-download').hidden).toBe(false);
 expect((el('local-helper-download') as HTMLAnchorElement).href).toMatch(/latest\/download\/qiaomu-clipper-helper\.pkg$/);
 state.outdated = false; el('local-helper-recheck').click();
 await vi.waitFor(() => expect(el('local-helper-note').textContent).toContain('已连接'));
 expect(el('local-helper-help').hidden).toBe(false);
 expect(el('local-helper-download').hidden).toBe(false);
 expect(state.send.mock.calls.some(([m]) => m.payload?.mode === 'start')).toBe(false);
});
it('offers the pkg for a missing helper and keeps the download page for other platforms', async () => {
 state.offline = true; await initializeLocalVaultSettings();
 expect(el('local-helper-download').hidden).toBe(false);
 expect(el('local-helper-note').textContent).toContain('还没安装');
 vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
 await initializeLocalVaultSettings();
 expect(el('local-helper-download').hidden).toBe(true);
 expect(el('local-helper-more').hidden).toBe(false);
});

it.each([{vaults:[]}, {vaults:[{name:'Only',path:'/vault/Only'}]}])('requires an explicit choice when no vault is configured: %j', async ({vaults}) => {
 state.send.mockImplementation(async (m:any) => m.action === 'qiaomuLocalListVaults' ? {ok:true,vaults} : {ok:true});
 await initializeLocalVaultSettings();
 const select=el('local-vault-select') as HTMLSelectElement;
 expect(select.value).toBe('');
 expect(select.selectedOptions[0].disabled).toBe(true);
});

it('remembers the configured vault on recheck and keeps repairable vault errors connected', async () => {
 state.send.mockImplementation(async (m:any) => m.action === 'qiaomuLocalStatus' ? {ok:true,vault:null,vaultError:'Configured vault was moved'} : {ok:true,vaults:[]});
 await initializeLocalVaultSettings();
 expect(el('local-vault-row').hidden).toBe(false);
 expect(el('local-vault-status').textContent).toContain('Configured vault was moved');
 state.send.mockImplementation(async (m:any) => m.action === 'qiaomuLocalStatus' ? {ok:true,vault:'Moved',vaultPath:'/vault/Moved'} : {ok:true,vaults:[]});
 el('local-helper-recheck').click();
 await vi.waitFor(()=>expect(setLocalStorage).toHaveBeenCalledWith('lastSelectedVault','Moved'));
});
