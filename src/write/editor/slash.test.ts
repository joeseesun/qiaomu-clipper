import { expect, it } from 'vitest';
import { SLASH_TRIGGER, matchCommands } from './slash';

it('opens on /, the Chinese enumeration comma and the full-width slash, at a line start or after a space', () => {
	for (const key of ['/', '、', '／']) {
		expect(SLASH_TRIGGER.exec(key)?.[1]).toBe('');
		expect(SLASH_TRIGGER.exec(`${key}图`)?.[1]).toBe('图');
		expect(SLASH_TRIGGER.exec(`正文 ${key}biao`)?.[1]).toBe('biao');
	}
});

it('stays out of the way inside words, links and ordinary Chinese lists', () => {
	expect(SLASH_TRIGGER.test('a/b')).toBe(false);
	expect(SLASH_TRIGGER.test('https://x.com/a')).toBe(false);
	expect(SLASH_TRIGGER.test('苹果、香蕉')).toBe(false);
	expect(SLASH_TRIGGER.test('/ 加空格')).toBe(false);
});

it('narrows the menu by title, hint or pinyin keyword', () => {
	const items = [{ id: 'a', title: '图片', hint: '从电脑选择', keywords: 'image tupian' }, { id: 'b', title: '表格', hint: '3 × 3', keywords: 'table biaoge' }] as never[];
	expect(matchCommands(items, 'tupian').map((i: any) => i.id)).toEqual(['a']);
	expect(matchCommands(items, '表').map((i: any) => i.id)).toEqual(['b']);
	expect(matchCommands(items, '').length).toBe(2);
});
