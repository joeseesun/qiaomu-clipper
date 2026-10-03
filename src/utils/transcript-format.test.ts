// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sourceParagraphs, withoutMusicCues, translationParagraphs, renderBilingualBlocks, sourceTextNodes } from './transcript-format';

it('removes background music cues but preserves technical brackets and meaningful emotion', () => {
	expect(withoutMusicCues('Hello [music] [background music] ♪ world [laughter] [O(n)] [12].')).toBe('Hello world [laughter] [O(n)] [12].');
	expect(translationParagraphs('他在泰国[音乐]认识一个人。\n\n“为什么不能是我？”\n这个想法很好。')).toEqual(['他在泰国认识一个人。', '“为什么不能是我？” 这个想法很好。']);
});

it('splits at sentence boundaries without changing names or dropping source characters', () => {
	const text = 'Dr. Smith met Tony Robbins. He had a great attitude. He said, "Why not me?" I thought it was a good frame. Happiness is a choice.';
	const paragraphs = sourceParagraphs(text);
	expect(paragraphs.join('')).toBe(text);
	expect(paragraphs[0]).toBe('Dr. Smith met Tony Robbins. He had a great attitude. ');
	expect(sourceParagraphs('x'.repeat(12000)).every(part => part.length <= 3500)).toBe(true);
});

it('counts only source characters for seeking and playback highlighting across bilingual blocks', () => {
	const source = document.createElement('div');
	renderBilingualBlocks(source, [{ original: 'First sentence. ', translation: '第一句话。\n\n第二个意思。' }, { original: 'Next sentence.', translation: '下一句话。' }]);
	expect(sourceTextNodes(source).map(node => node.data).join('')).toBe('First sentence. Next sentence.');
	expect(source.querySelectorAll('.transcript-translation p')).toHaveLength(3);
});


it('keeps quoted speech together and recognizes Chinese sentence endings without spaces', () => {
	const quote = 'He said, "Why not me? I will take on that burden. I will be that guy." Then I replied. A final thought.';
	const paragraphs = sourceParagraphs(quote);
	expect(paragraphs[0]).toContain('I will be that guy."');
	expect(paragraphs.join('')).toBe(quote);
	expect(sourceParagraphs('第一句。第二句。第三句。')).toEqual(['第一句。第二句。', '第三句。']);
});
