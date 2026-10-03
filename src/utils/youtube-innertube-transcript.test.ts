// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { formatClock } from './youtube-innertube-transcript';
import { groupSegments, transcriptHtml } from './youtube-dom-transcript';

beforeEach(() => { document.head.innerHTML = ''; document.documentElement.lang = 'zh-CN'; });

it('formats clock labels', () => { expect(formatClock(0)).toBe('0:00'); expect(formatClock(75000)).toBe('1:15'); expect(formatClock(3723900)).toBe('1:02:03'); });

it('groups two-second caption lines into paragraphs, keeping the first line\'s time and not splitting CJK words with spaces', () => {
	const lines = [['0:00', 'The more free you are,'], ['0:03', 'the better you can allocate.'], ['0:14', 'Next idea starts here'], ['0:50', 'A much later line']].map(([time, text]) => ({ time, text }));
	expect(groupSegments(lines)).toEqual([{ time: '0:00', text: 'The more free you are, the better you can allocate.' }, { time: '0:14', text: 'Next idea starts here' }, { time: '0:50', text: 'A much later line' }]);
	expect(groupSegments([{ time: '0:00', text: '默认说不' }, { time: '0:02', text: '是为了自由' }])[0].text).toBe('默认说不是为了自由');
	expect(transcriptHtml(lines)).toContain('data-timestamp="14"');
});
