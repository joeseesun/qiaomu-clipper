import { beforeEach, expect, it, vi } from 'vitest';
const message = vi.hoisted(() => vi.fn());
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: message } } }));
import { generateCodexImage } from './codex-image';
beforeEach(() => { message.mockReset(); });
it('restores an existing native job by polling its id without ever restarting generation', async () => {
	message.mockImplementation(async request => request.action === 'codexImagePoll'
		? { ok: true, state: 'ready', size: 3, type: 'image/png' }
		: { ok: true, data: btoa('png'), next: 3 });
	const blob = await generateCodexImage('Cat', '1:1', 'default', undefined, 'existing-job', true);
	expect(await blob.text()).toBe('png');
	expect(message.mock.calls.map(([request]) => request.action)).toEqual(['codexImagePoll', 'codexImageRead']);
	expect(message.mock.calls.every(([request]) => request.id === 'existing-job')).toBe(true);
});
it('a missing native job cannot trigger an automatic paid retry', async () => {
	message.mockResolvedValue({ ok: false, error: 'codex-image-missing' });
	await expect(generateCodexImage('Cat', '1:1', 'default', undefined, 'missing-job', true)).rejects.toThrow('codex-image-missing');
	expect(message).toHaveBeenCalledTimes(1);
	expect(message.mock.calls[0][0].action).toBe('codexImagePoll');
});
it.each(['default', 'imagegen'])('starts a new %s job using Codex orchestration defaults, then rejects nonadvancing image chunks', async model => {
	message.mockImplementation(async request => request.action === 'codexImageStart' ? { ok: true }
		: request.action === 'codexImagePoll' ? { ok: true, state: 'ready', size: 3, type: 'image/png' }
			: { ok: true, data: btoa('png'), next: 0 });
	await expect(generateCodexImage('Cat', '1:1', model, undefined, 'new-job')).rejects.toThrow('empty-image');
	expect(message.mock.calls.filter(([request]) => request.action === 'codexImageStart')).toHaveLength(1);
	expect(message.mock.calls[0][0]).toMatchObject({ id: 'new-job', model: '' });
});
