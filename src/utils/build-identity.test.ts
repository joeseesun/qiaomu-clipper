import { describe, expect, it } from 'vitest';
import { buildIdentityLabel } from './build-identity';

describe('build identity', () => {
	const info = { version: '1.17.0', target: 'chrome-store', mode: 'production', commit: 'abcdef1234567', sourceHash: '12345678abcdefgh', dirty: false };
	it('labels manually prepared store builds as testing, not published', () => {
		expect(buildIdentityLabel({ ...info, testInstall: true })).toBe('商店版 · 测试版 · abcdef1 / 12345678');
	});
	it('keeps edition, development mode and uncommitted source distinguishable', () => {
		expect(buildIdentityLabel({ ...info, target: 'chrome-local', mode: 'development', dirty: true })).toBe('独立版 · 开发版 · abcdef1 / 12345678 · 含未提交修改');
	});
});
