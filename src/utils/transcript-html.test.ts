import { describe, expect, it } from 'vitest';
import { transcriptHtml } from './youtube-dom-transcript';

describe('generated transcript markup', () => {
	it('puts the time and the sentence side by side with no dot between them', () => {
		const html = transcriptHtml([{ time: '0:00', start: 0, end: 4.6, text: '兄弟们，我怀疑怪兽中出了一个奥特曼的卧底。' }, { time: '0:15', start: 15, end: 20, text: 'Second line' }], false);
		expect(html).not.toContain('·');
		expect(html).toContain('</strong> 兄弟们，我怀疑怪兽中出了一个奥特曼的卧底。</p>');
		expect(html.match(/class="transcript-segment"/g)?.length).toBe(2);
	});
});
