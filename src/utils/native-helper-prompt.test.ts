import { describe, expect, test } from 'vitest';
import { describeHelperFailure, nativeHelperRepairPrompt } from './native-helper-prompt';

describe('describeHelperFailure', () => {
	test('maps Chrome native-messaging errors to a specific cause', () => {
		expect(describeHelperFailure('Specified native messaging host not found.')).toContain('还没安装');
		expect(describeHelperFailure('Access to the specified native messaging host is forbidden.')).toContain('扩展 ID');
		expect(describeHelperFailure('Native host has exited.')).toContain('Python');
		expect(describeHelperFailure(undefined)).toContain('未连接');
	});
});

describe('nativeHelperRepairPrompt', () => {
	test('carries the extension id and the browser error so the AI can act on it', () => {
		const prompt = nativeHelperRepairPrompt('abcdefghijklmnopabcdefghijklmnop', 'Native host has exited.');
		expect(prompt).toContain('--extension-id abcdefghijklmnopabcdefghijklmnop');
		expect(prompt).toContain('Native host has exited.');
		expect(prompt).toContain('--check');
	});
	test('omits the error line when there is none', () => {
		expect(nativeHelperRepairPrompt('a'.repeat(32))).not.toContain('原始错误');
	});
});
