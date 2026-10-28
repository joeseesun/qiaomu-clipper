import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, findInBlocks, normalizeProposal, parseReply } from './protocol';

const block = (json: unknown) => `\`\`\`qm-action\n${JSON.stringify(json)}\n\`\`\``;

it('pulls proposals out of a reply and keeps the explanation', () => {
	const reply = `这个标题更有力。\n\n${block({ type: 'setTitle', title: '新的标题' })}\n\n再补一句：\n${block({ type: 'insert', where: 'end', markdown: '## 结尾\n\n谢谢。' })}`;
	const parsed = parseReply(reply);
	expect(parsed.text).toBe('这个标题更有力。\n\n再补一句：');
	expect(parsed.proposals).toEqual([{ type: 'setTitle', title: '新的标题' }, { type: 'insert', where: 'end', markdown: '## 结尾\n\n谢谢。' }]);
	expect(parsed.pending).toBe(false);
});

it('holds back a block that is still streaming and drops broken ones', () => {
	const streaming = parseReply('先说明。\n```qm-action\n{"type":"setTi');
	expect(streaming).toMatchObject({ text: '先说明。', proposals: [], pending: true });
	expect(parseReply('```qm-action\n{not json}\n```\n后面').proposals).toEqual([]);
	expect(parseReply('```qm-action\n{"type":"deleteEverything"}\n```').proposals).toEqual([]);
});

it('validates every kind of proposal and fills in defaults', () => {
	expect(normalizeProposal({ type: 'replace', find: '旧', with: '新' })).toEqual({ type: 'replace', find: '旧', with: '新' });
	expect(normalizeProposal({ type: 'replace', find: '  ', with: 'x' })).toBeUndefined();
	expect(normalizeProposal({ type: 'insert', markdown: '正文' })).toEqual({ type: 'insert', where: 'cursor', markdown: '正文' });
	expect(normalizeProposal({ type: 'image', prompt: '山', aspect: '5:7' })).toEqual({ type: 'image', prompt: '山', where: 'cursor', aspect: '16:9' });
	expect(normalizeProposal({ type: 'image', prompt: '山', aspect: '1:1', where: 'end' })).toMatchObject({ aspect: '1:1', where: 'end' });
	expect(normalizeProposal({ type: 'setDigest', text: '' })).toBeUndefined();
	expect(normalizeProposal(null)).toBeUndefined();
});

it('tells the model about the article, the selection and whether pictures can be made', () => {
	const base = { title: '标题', digest: '', markdown: '正文内容', selection: '被选中的', headings: ['一', '二'], imageReady: true };
	const prompt = buildSystemPrompt(base);
	expect(prompt).toContain('【文章标题】标题');
	expect(prompt).toContain('被选中的');
	expect(prompt).toContain('- 一');
	expect(prompt).toContain('"type":"image"');
	expect(buildSystemPrompt({ ...base, imageReady: false })).not.toContain('"type":"image"');
	expect(buildSystemPrompt({ ...base, markdown: 'x'.repeat(13000) + 'ARTICLE_END', selection: 's'.repeat(5000) + 'SELECTION_END' })).toContain('x'.repeat(13000) + 'ARTICLE_END');
	expect(buildSystemPrompt({ ...base, selection: 's'.repeat(5000) + 'SELECTION_END' })).toContain('SELECTION_END');
});

it('finds quoted text inside a single paragraph', () => {
	const blocks = [{ start: 1, text: '第一段原文。' }, { start: 10, text: '第二段有一句重要的话。' }];
	expect(findInBlocks(blocks, '重要的话')).toEqual({ from: 10 + 6, to: 10 + 10 });
	expect(findInBlocks(blocks, '  第一段  ')).toEqual({ from: 1, to: 4 });
	expect(findInBlocks(blocks, '不存在')).toBeUndefined();
});

it('accepts a question for the writer with a few options', () => {
	expect(normalizeProposal({ type: 'ask', question: '写给谁看？', options: [{ label: '同行', description: '懂行的人' }, '普通读者', { label: '' }] })).toEqual({ type: 'ask', question: '写给谁看？', options: [{ label: '同行', description: '懂行的人' }, { label: '普通读者' }], allowOther: true });
	expect(normalizeProposal({ type: 'ask', question: '这样行吗？', options: [{ label: '行' }], allowOther: false })).toMatchObject({ allowOther: false });
	expect(normalizeProposal({ type: 'ask', question: '', options: [] })).toBeUndefined();
	expect(buildSystemPrompt({ title: 't', digest: '', markdown: '正文', selection: '', headings: [], imageReady: false, includeArticle: false, references: '<网页>x</网页>' })).toContain('这次没有附上正文');
	expect(buildSystemPrompt({ title: 't', digest: '', markdown: '正文', selection: '', headings: [], imageReady: false, references: '<网页>x</网页>' })).toContain('【作者附加的资料】');
});

describe('long blocks', () => {
	it('repairs raw line breaks inside a JSON string', () => {
		const parsed = parseReply('好。\n```qm-action\n{"type":"insert","where":"end","markdown":"第一段\n\n第二段"}\n```');
		expect(parsed.proposals).toHaveLength(1);
	});
	it('reports how much of an unfinished block has arrived', () => {
		const parsed = parseReply('好。\n```qm-action\n{"type":"insert","markdown":"abc');
		expect(parsed.pending).toBe(true);
		expect(parsed.pendingChars).toBeGreaterThan(10);
	});
});
