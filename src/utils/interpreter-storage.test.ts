import { describe, expect, it } from 'vitest';
import { decodeInterpreterSettings, encodeInterpreterSettings, interpreterChunkKeys, INTERPRETER_KEY } from './interpreter-storage';
const settings = { interpreterModel: '', models: [], providers: [], interpreterEnabled: false, interpreterAutoRun: false, defaultPromptContext: '' };

describe('AI settings sync storage', () => {
	it('reads legacy settings and keeps small configurations compatible', () => {
		const encoded = encodeInterpreterSettings(settings);
		expect(encoded).toEqual({ [INTERPRETER_KEY]: settings });
		expect(decodeInterpreterSettings(encoded)).toEqual(settings);
		expect(decodeInterpreterSettings({})).toBeUndefined();
	});
	it('round trips many selected models and long account tokens within per-item limits', () => {
		const large = { ...settings, models: Array.from({length: 100}, (_, i) => ({id: String(i), name: `模型 ${i} 中文 🐟`, providerId: 'p', providerModelId: `long-model-${i}`, enabled: true})), providers: [{ id: 'p', name: 'Account', baseUrl: 'https://example.com', apiKey: '', oauth: { kind: 'codex' as const, clientId: 'test', access: 'a'.repeat(16000), refresh: 'b'.repeat(10000), expires: 123 } }] };
		const encoded = encodeInterpreterSettings(large);
		for (const [key, value] of Object.entries(encoded)) expect(new TextEncoder().encode(JSON.stringify(value)).length + key.length).toBeLessThan(8192);
		expect(interpreterChunkKeys(encoded[INTERPRETER_KEY]).length).toBeGreaterThan(1);
		expect(decodeInterpreterSettings(encoded)).toEqual(large);
	});
	it('does not erase settings when a sync batch is incomplete', () => {
		expect(() => decodeInterpreterSettings({ [INTERPRETER_KEY]: { chunked: 1, chunkCount: 2 }, interpreter_settings_chunk_0: '{}' })).toThrow('Incomplete AI settings');
		expect(() => decodeInterpreterSettings({ [INTERPRETER_KEY]: { chunked: 1, chunkCount: -1 } })).toThrow();
	});
});
