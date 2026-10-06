import { beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ data: {} as Record<string, unknown>, fail: false }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { sync: {
	get: vi.fn(async (key: string | null) => key ? { [key]: store.data[key] } : structuredClone(store.data)),
	set: vi.fn(async (items: Record<string, unknown>) => {
		if (store.fail) throw new Error('storage unavailable');
		for (const [key, value] of Object.entries(items)) if (new TextEncoder().encode(JSON.stringify(value)).length + key.length > 8192) throw new Error('QUOTA_BYTES_PER_ITEM');
		Object.assign(store.data, structuredClone(items));
	}),
	remove: vi.fn(async (keys: string[]) => {keys.forEach(key => delete store.data[key]);})
} } } }));
vi.mock('./debug', () => ({ debugLog: vi.fn() }));
import * as settings from './storage-utils';
beforeEach(async () => { store.data={migrationVersion:1}; store.fail=false; await settings.loadSettings(); });
it('saves a large model selection and account token then restores them after reload', async () => {
	settings.generalSettings.models = Array.from({length:100},(_,i)=>({id:String(i),providerId:'p',providerModelId:`model-${i}`,name:`模型 ${i}`,enabled:true}));
	settings.generalSettings.providers = [{id:'p',name:'Account',baseUrl:'https://example.com',apiKey:'',oauth:{kind:'codex',clientId:'test',access:'a'.repeat(15000),refresh:'b'.repeat(8000),expires:1}}];
	await settings.saveSettings();
	settings.generalSettings.models=[]; settings.generalSettings.providers=[];
	await settings.loadSettings();
	expect(settings.generalSettings.models).toHaveLength(100);
	expect(settings.generalSettings.providers[0].oauth?.access).toHaveLength(15000);
	settings.generalSettings.models=[]; settings.generalSettings.providers=[];
	await settings.saveSettings(); await settings.loadSettings();
	expect(settings.generalSettings.models).toEqual([]);
	expect(Object.keys(store.data).some(key=>key.startsWith('interpreter_settings_chunk_'))).toBe(false);
});
it('preserves stored models when a save fails', async () => {
	settings.generalSettings.models=[{id:'existing',providerId:'p',providerModelId:'existing',name:'Existing',enabled:true}];
	await settings.saveSettings();
	settings.generalSettings.models=[]; store.fail=true;
	await expect(settings.saveSettings()).rejects.toThrow('storage unavailable');
	store.fail=false; await settings.loadSettings();
	expect(settings.generalSettings.models[0].id).toBe('existing');
});
it('reads legacy model/provider settings without a migration or data loss', async () => {
	store.data.interpreter_settings={models:[{id:'legacy',providerId:'p',name:'Legacy',enabled:true}],providers:[{id:'p',name:'Custom',apiKey:'test',baseUrl:'https://example.com'}],interpreterEnabled:true};
	await settings.loadSettings();
	expect(settings.generalSettings.models[0].id).toBe('legacy');
	expect(settings.generalSettings.providers[0].apiKey).toBe('test');
	expect(settings.generalSettings.interpreterEnabled).toBe(true);
});
