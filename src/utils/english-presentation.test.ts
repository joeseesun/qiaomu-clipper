// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { appendLearningText, appendStudyText } from './english-presentation';

const compact = (text: string) => text.replace(/\s+/g, '');
it('separates clearly paired examples without dropping or rewriting their content', () => {
	const text = 'Getting enough sleep keeps me resilient during busy weeks. 睡眠充足让我在忙碌的几周里更能扛。A five-minute chat with a friend can make you feel resilient again. 和朋友聊五分钟能让你重新感到有力量。';
	const target = document.createElement('section'); appendLearningText(target, text, true);
	expect(compact(target.textContent!)).toBe(compact(text));
	expect(target.querySelectorAll('.example')).toHaveLength(2);
	expect(target.querySelector('.english')!.textContent).toBe('Getting enough sleep keeps me resilient during busy weeks.');
});

it('preserves qualifications, punctuation, numbered examples and long mixed text', () => {
	for (const text of [
		'1. She stayed resilient. 她依然坚韧。\n2. It bounced back. 它弹了回来。',
		'这里的 resilient 不是“从不受伤”；语境不足时不能推断。\n\n“remain + 形容词”强调状态持续。',
		'“Don’t give up,” she said. 她说：“不要放弃。”',
		'Only English, without a Chinese translation.',
		'词典和模型都不能为这段内容提供足够语境。'.repeat(250),
	]) {
		const target = document.createElement('section'); appendLearningText(target, text, true);
		expect(compact(target.textContent!)).toBe(compact(text));
	}
});

it('keeps response markup inert even when formatting bilingual examples', () => {
	const target = document.createElement('section');
	appendLearningText(target, '<img src=x onerror=alert(1)>Hello. 你好。\n<script>alert(1)</script>', true);
	expect(target.querySelector('img,script')).toBeNull();
	expect(target.textContent).toContain('<img src=x onerror=alert(1)>');
	expect(target.textContent).toContain('<script>alert(1)</script>');
});


it('highlights complete study terms without rewriting text or matching a different word', () => {
	const target = document.createElement('p'), text = 'Resilient people stay resilient, rather than merely acting resiliently.';
	appendStudyText(target, text, '“resilient,”');
	expect(target.textContent).toBe(text);
	expect(Array.from(target.querySelectorAll('mark')).map(n => n.textContent)).toEqual(['Resilient', 'resilient']);
	appendStudyText(target, 'The US works with us. Us, not US.', 'us');
	expect(Array.from(target.querySelectorAll('mark')).map(n => n.textContent)).toEqual(['us', 'Us']);
	appendStudyText(target, 'Polish polish', 'Polish');
	expect(Array.from(target.querySelectorAll('mark')).map(n => n.textContent)).toEqual(['Polish']);
});

it('marks literal phrases and punctuation safely in examples', () => {
	const target = document.createElement('p');
	appendStudyText(target, 'Do not take for granted what you have. <img src=x> Take for granted.', 'take for granted');
	expect(target.querySelectorAll('mark')).toHaveLength(2); expect(target.querySelector('img')).toBeNull();
	appendStudyText(target, 'U.S. and UxSx', 'U.S.');
	expect(Array.from(target.querySelectorAll('mark')).map(n => n.textContent)).toEqual(['U.S.']);
});

it('matches typographic apostrophes and hyphens while keeping the original characters', () => {
	for (const [selected, text, marked] of [
		['don’t', 'Don’t stop. I don’t know. They don\'t either.', ['Don’t', 'don’t', "don't"]],
		['mother‑in‑law', 'Her mother‑in‑law and my mother-in-law met.', ['mother‑in‑law', 'mother-in-law']],
	] as Array<[string, string, string[]]>) {
		const target = document.createElement('p'); appendStudyText(target, text, selected);
		expect(target.textContent).toBe(text);
		expect(Array.from(target.querySelectorAll('mark')).map(n => n.textContent)).toEqual(marked);
	}
});
