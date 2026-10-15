import { describe, expect, it } from 'vitest';
import { helperInstallUrl, classifyHelperError, helperIsOutdated, helperInstallPrompt, helperProblemText } from './helper-install';
describe('helper install help', () => {
	it('tells the usual Chrome failures apart', () => {
		expect(classifyHelperError(new Error('Specified native messaging host not found.'))).toBe('not-installed');
		expect(classifyHelperError(new Error('Access to the specified native messaging host is forbidden.'))).toBe('not-allowed');
		expect(classifyHelperError(new Error('Native host has exited.'))).toBe('not-running');
		expect(classifyHelperError('something else')).toBe('unknown');
		expect(helperProblemText('not-installed')).toContain('还没安装');
	});
	it('only asks to update a helper that names an older version', () => {
		expect(helperIsOutdated(undefined)).toBe(false);
		expect(helperIsOutdated(1)).toBe(true);
		expect(helperIsOutdated(2)).toBe(false);
	});
	it('puts this extension\'s own ID into the message for the AI', () => {
		const prompt = helperInstallPrompt('a'.repeat(32));
		expect(prompt).toContain('--extension-id ' + 'a'.repeat(32));
		expect(prompt).toContain('github.com/joeseesun/qiaomu-clipper');
	});
});

it('routes macOS to the fixed installer and Windows to its installation instructions', () => {
 expect(helperInstallUrl('mac')).toBe('https://github.com/joeseesun/qiaomu-clipper/releases/latest/download/qiaomu-clipper-helper.pkg');
 expect(helperInstallUrl('win')).toBe('https://github.com/joeseesun/qiaomu-clipper/blob/main/native/README.md#windows');
 expect(helperInstallUrl('linux')).toContain('/native/README.md#本地静默剪藏助手');
});
