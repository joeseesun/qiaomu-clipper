// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './ui-en.json';
import zhTW from './ui-zh_TW.json';
import { pageStrings, sourceStrings } from './collect';

const all = new Map([...pageStrings(), ...sourceStrings()]);

// Set I18N_DUMP=file.json to write the strings that still lack a translation (for the person filling the catalogs).
if (process.env.I18N_DUMP) {
	const missing = [...all.keys()].filter(key => !(key in en) || !(key in zhTW));
	fs.writeFileSync(path.resolve(process.env.I18N_DUMP), JSON.stringify(missing, null, 1));
}

describe('interface text catalogs', () => {
	it('English has every string the pages and code show', () => {
		expect([...all].filter(([key]) => !(key in en)).map(([key, file]) => `${file}: ${key}`)).toEqual([]);
	});
	it('Traditional Chinese has every string the pages and code show', () => {
		expect([...all].filter(([key]) => !(key in zhTW)).map(([key, file]) => `${file}: ${key}`)).toEqual([]);
	});
	it('keeps placeholders in step with the Chinese text', () => {
		const holes = (value: string) => (value.match(/\{\d+\}/g) || []).sort().join(',');
		const wrong = [...all.keys()].filter(key => (key in en && holes(en[key as keyof typeof en]) !== holes(key)) || (key in zhTW && holes(zhTW[key as keyof typeof zhTW]) !== holes(key)));
		expect(wrong).toEqual([]);
	});
});
