import { expect, it } from 'vitest';
import { readerScriptPolicy } from './reader-security';

it('allows packaged modules and WASM on Chrome extension pages without inline scripts or remote code', () => {
	const policy = readerScriptPolicy('chrome-extension:');
	expect(policy).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'none';");
	expect(policy).not.toContain("'unsafe-eval'");
	expect(policy).not.toContain("'unsafe-inline'");
	expect(policy).not.toContain('https:');
});

it('keeps source webpages and unknown contexts blocked', () => {
	for (const protocol of ['https:', 'http:', 'file:', '', 'chrome-extension-unsafe:']) {
		expect(readerScriptPolicy(protocol)).toBe("script-src 'none'; object-src 'none';");
	}
});
