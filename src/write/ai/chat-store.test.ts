import { expect, it } from 'vitest';
import { normalizeSessions } from './chat-store';
import { normalizeProposal } from './protocol';

it('retains long model replies and older turns when a writing conversation is saved/restored', () => {
	const content = '正文'.repeat(20000) + 'THE END';
	const messages = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i === 79 ? content : `turn ${i}` }));
	const session = normalizeSessions([{ id: 'a', title: 't', updatedAt: 1, messages }])[0];
	expect(session.messages).toHaveLength(80);
	expect(session.messages[0].content).toBe('turn 0');
	expect(session.messages[79].content).toBe(content);
	expect(normalizeProposal({ type: 'insert', where: 'end', markdown: content })).toMatchObject({ markdown: content });
});
