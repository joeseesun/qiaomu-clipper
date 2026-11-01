import { expect, it, vi } from 'vitest';
import { CodexChatStream } from './codex-chat-stream';
import { normalizeToolResults, parseChatTools } from './chat-tools-types';

const event = (method: string, item: any) => ({ type: 'event', method, params: { item } });
function setup() {
	const onDelta = vi.fn(), onTools = vi.fn();
	const stream = new CodexChatStream({ onDelta, onTools }); stream.start();
	return { stream, onDelta, onTools };
}
it('preserves more than ten native executions, open/find actions and safe clickable evidence after reopening', () => {
	const { stream, onTools } = setup();
	for (let i = 0; i < 14; i++) {
		stream.accept(event('item/started', { type: 'webSearch', id: `w${i}` }));
		stream.accept(event('item/completed', { type: 'webSearch', id: `w${i}`, action: { type: i === 12 ? 'openPage' : i === 13 ? 'findInPage' : 'search', query: `q${i}`, pattern: i === 13 ? 'resume' : undefined }, results: [{ ref_id: `turn${i}search0`, title: 'Official', url: 'https://example.com/source', snippet: 'Evidence' }, { url: 'file:///secret' }] }));
	}
	const saved = normalizeToolResults(onTools.mock.lastCall![0]);
	expect(saved).toHaveLength(15);
	expect(saved[13].call).toMatchObject({ tool: 'web_extractor', provider: 'codex' });
	expect(saved[14].call).toMatchObject({ tool: 'web_find', provider: 'codex' });
	expect(saved[14].sources).toEqual([{ title: 'Official', url: 'https://example.com/source', snippet: 'Evidence' }]);
	expect(saved[0]).toMatchObject({ state: 'error', error: 'interrupted' });
});
it('separates actual commentary from the final answer and does not duplicate completed text', () => {
	const { stream, onDelta, onTools } = setup();
	stream.accept(event('item/started', { type: 'agentMessage', id: 'p', phase: 'commentary' }));
	stream.accept({ type: 'event', method: 'item/agentMessage/delta', params: { itemId: 'p', delta: 'Checking sources' } });
	stream.accept(event('item/completed', { type: 'agentMessage', id: 'p', phase: 'commentary', text: 'Checking sources' }));
	stream.accept(event('item/started', { type: 'agentMessage', id: 'a', phase: 'final_answer' }));
	stream.accept({ type: 'event', method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Verified' } });
	stream.accept(event('item/completed', { type: 'agentMessage', id: 'a', text: 'Verified answer' }));
	stream.accept({ type: 'done' });
	expect(stream.finish()).toBe('Verified answer');
	expect(onDelta.mock.calls.flat().join('')).toBe('Verified answer');
	expect(onTools.mock.lastCall![0].find((x: any) => x.id === 'p').content).toBe('Checking sources');
});
it('resolves native citation IDs only from real returned sources', () => {
	const { stream } = setup();
	stream.accept(event('item/completed', { type: 'webSearch', id: 'w', results: [{ ref_id: 'turn0search0', url: 'https://example.com/', title: 'Source' }] }));
	stream.accept(event('item/completed', { type: 'agentMessage', id: 'a', text: 'A citeturn0search0' }));
	stream.accept({ type: 'done' });
	expect(stream.finish()).toBe('A [Source](https://example.com/)');
});
it('keeps completed evidence and marks only running calls interrupted on cancellation', () => {
	const { stream, onTools } = setup();
	stream.accept(event('item/completed', { type: 'webSearch', id: 'done' }));
	stream.accept(event('item/started', { type: 'webSearch', id: 'pending' }));
	stream.interrupt();
	expect(onTools.mock.lastCall![0].find((x: any) => x.id === 'done').state).toBe('done');
	expect(onTools.mock.lastCall![0].find((x: any) => x.id === 'pending')).toMatchObject({ state: 'error', error: 'interrupted' });
	expect(() => stream.finish()).toThrow('完成前中断');
});
it('does not treat partial text or a tool completion as turn success', () => {
	const { stream } = setup();
	stream.accept(event('item/completed', { type: 'agentMessage', id: 'a', text: 'partial' }));
	expect(() => stream.finish()).toThrow();
	expect(() => stream.accept({ type: 'error', message: 'quota exceeded' })).toThrow('quota exceeded');
	expect(parseChatTools('```qm-tool\n{"type":"provider_tool","provider":"codex","tool":"web_search"}\n```').calls).toEqual([]);
});
