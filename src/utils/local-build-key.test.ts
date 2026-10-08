import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The local (unpacked) Chrome build carries the Web Store item's public key, so it gets the store's extension ID and the
// local helper can allow it before anyone installs anything. If the key and the ID ever drift apart, that promise breaks.
const STORE_ID = 'jniolfihillilkoajpnonlbkhfkiicoo';
const idFromKey = (base64Key: string) => [...createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

describe('local build key', () => {
	it('derives the Web Store extension ID', () => {
		expect(idFromKey(readFileSync('scripts/chrome-local-key.txt', 'utf8').trim())).toBe(STORE_ID);
	});
	it('is left out of the source manifest, so the store package never carries it', () => {
		expect(JSON.parse(readFileSync('src/manifest.chrome.json', 'utf8')).key).toBeUndefined();
	});
	it('is the ID the helper installer always allows', () => {
		expect(readFileSync('native/install.py', 'utf8')).toContain(`STORE_ID='${STORE_ID}'`);
	});
});
