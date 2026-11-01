import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ port: undefined as any, connect: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async () => ({ qiaomuCodexChatNamespace: 'test-profile-scope' }), set: vi.fn() } }, runtime: { connectNative: (...a: any[]) => mock.connect(...a) } } }));
vi.mock('./web-search', () => ({ loadWebSearch: async () => ({ enabled: true }) }));
import { streamCodexChat } from './codex-chat';
const options = () => ({ provider: { oauth: { kind: 'codex', email: 'test@example.com', access: 'DO-NOT-FORWARD', refresh: 'ALSO-SECRET' } } as any, model: { providerModelId: 'same-model', reasoningEffort: 'high' } as any,
	system: 'context', sessionId: 'stable-conversation', messages: [{ role: 'user' as const, content: 'hello' }], onDelta: vi.fn(), onNativeTools: vi.fn() });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
	vi.clearAllMocks(); let message = (_: any) => {}, disconnect = () => {};
	mock.port = { onMessage: { addListener: (f: any) => message = f }, onDisconnect: { addListener: (f: any) => disconnect = f }, postMessage: vi.fn(), disconnect: vi.fn(), emit: (v: any) => message(v), close: () => disconnect() };
	mock.connect.mockReturnValue(mock.port);
});
it('sends model, effort and stable profile/conversation identity without OAuth tokens', async () => {
	const result = streamCodexChat(options()); await flush();
	const sent = mock.port.postMessage.mock.calls[0][0];
	expect(sent).toMatchObject({ model: 'same-model', effort: 'high', namespace: 'test-profile-scope', sessionId: 'stable-conversation', web: true });
	expect(JSON.stringify(sent)).not.toContain('SECRET'); expect(JSON.stringify(sent)).not.toContain('DO-NOT-FORWARD');
	mock.port.emit({ type: 'event', method: 'item/completed', params: { item: { type: 'agentMessage', id: 'a', phase: 'final_answer', text: 'answer' } } });
	mock.port.emit({ type: 'done' }); expect(await result).toBe('answer');
});
it('rejects missing terminal events and sends cancellation to the native process', async () => {
	const ctrl = new AbortController(), input = options();
	const result = streamCodexChat({ ...input, signal: ctrl.signal }); const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
	await flush(); ctrl.abort(); await assertion;
	expect(mock.port.postMessage).toHaveBeenCalledWith({ action: 'cancel' });
	expect(mock.port.disconnect).toHaveBeenCalled();
	expect(input.onNativeTools.mock.lastCall![0][0]).toMatchObject({ state: 'error', error: 'interrupted' });
});
it('reassembles chunked events and reports host failures without HTTP fallback', async () => {
	const result = streamCodexChat(options()); const assertion = expect(result).rejects.toThrow('账号不一致'); await flush();
	const raw = JSON.stringify({ type: 'error', message: '账号不一致' });
	mock.port.emit({ type: 'chunk', id: 'chunk', text: raw.slice(0, 12), last: false });
	mock.port.emit({ type: 'chunk', id: 'chunk', text: raw.slice(12), last: true });
	await assertion;
});
