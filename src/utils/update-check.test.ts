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
