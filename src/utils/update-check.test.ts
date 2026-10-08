import { describe, expect, it, vi } from 'vitest';
import { RELEASES_URL, checkForUpdate, compareVersions } from './update-check';

const answer = (body: unknown, init: ResponseInit = {}) => vi.fn(async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;

describe('update check', () => {
	it('compares versions part by part', () => {
		expect(compareVersions('1.15.0', '1.14.4')).toBe(1); expect(compareVersions('1.14.4', '1.14.10')).toBe(-1);
		expect(compareVersions('v1.14.4', '1.14.4')).toBe(0); expect(compareVersions('2', '1.99.99')).toBe(1); expect(compareVersions('1.14', '1.14.0')).toBe(0);
	});
	it('says when a newer release is out, with where to get it', async () => {
		const status = await checkForUpdate('1.14.4', answer({ tag_name: '1.15.0', html_url: `${RELEASES_URL}/tag/1.15.0` }));
		expect(status).toEqual({ state: 'newer', version: '1.15.0', url: `${RELEASES_URL}/tag/1.15.0` });
	});
	it('says current only when it really read the latest release', async () => {
		expect(await checkForUpdate('1.14.4', answer({ tag_name: '1.14.4' }))).toEqual({ state: 'current', version: '1.14.4' });
		expect(await checkForUpdate('1.15.0', answer({ tag_name: '1.14.4' }))).toEqual({ state: 'current', version: '1.15.0' });   // ahead of the release (a local build)
	});
	it('never claims "up to date" when the check failed, and ignores drafts, pre-releases and foreign links', async () => {
		expect(await checkForUpdate('1.14.4', answer({}, { status: 403 }))).toEqual({ state: 'unknown' });
		expect(await checkForUpdate('1.14.4', vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toEqual({ state: 'unknown' });
		expect(await checkForUpdate('1.14.4', answer({ tag_name: '9.0.0', prerelease: true }))).toEqual({ state: 'unknown' });
		expect(await checkForUpdate('1.14.4', answer({ tag_name: 'not-a-version' }))).toEqual({ state: 'unknown' });
		const foreign = await checkForUpdate('1.14.4', answer({ tag_name: '1.15.0', html_url: 'https://evil.example/x' }));
		expect(foreign).toEqual({ state: 'newer', version: '1.15.0', url: RELEASES_URL });
	});
});

import { releaseNoteLines, latestReleaseNotes } from './update-check';
describe('release notes', () => {
	it('keeps headings, items and text as plain words', () => {
		const lines = releaseNoteLines('## 新增\n- **下载**：[详情](https://x.y/z) 可用\n\n---\n普通一句\n**Full Changelog**: https://github.com/a/b/compare/1...2');
		expect(lines).toEqual([{ kind: 'heading', text: '新增' }, { kind: 'item', text: '下载：详情 可用' }, { kind: 'text', text: '普通一句' }]);
	});
	it('says nothing for a draft, a prerelease or a failed request', async () => {
		const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
		expect(await latestReleaseNotes(reply({ tag_name: '1.2.0', body: '- a', draft: true }))).toBeUndefined();
		expect(await latestReleaseNotes(reply({}, false))).toBeUndefined();
		expect((await latestReleaseNotes(reply({ tag_name: 'v1.2.0', body: '- a', published_at: '2026-10-01T00:00:00Z' })))?.version).toBe('1.2.0');
	});
});

import { releaseBodyFor } from './update-check';
describe('release notes in two languages', () => {
	const body = 'intro\n## 中文\n- 新增下载\n## English\n- Added downloads';
	it('gives each reader their own part', () => {
		expect(releaseBodyFor(body, true).trim()).toBe('- Added downloads');
		expect(releaseBodyFor(body, false).trim()).toBe('- 新增下载');
	});
	it('keeps a single-language body as it is', () => { expect(releaseBodyFor('- only one', true)).toBe('- only one'); });
});
