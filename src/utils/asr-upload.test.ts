import { beforeEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: (...args: unknown[]) => send(...args) } } }));
import { AUDIO_FILE, UPLOAD_CHUNK, asrUpload } from './asr-client';
beforeEach(() => { send.mockReset(); });

it('sends a file to the helper in pieces, in order, and returns the key it is known by', async () => {
	const payloads: Array<Record<string, any>> = [];
	send.mockImplementation(async (message: { payload: Record<string, any> }) => { payloads.push(message.payload); return message.payload.mode === 'uploadStart' ? { ok: true, uploadId: 'a'.repeat(32) } : message.payload.mode === 'uploadFinish' ? { ok: true, key: 'file:' + 'c'.repeat(32) } : { ok: true }; });
	const file = new File([new Uint8Array(UPLOAD_CHUNK * 2 + 10).fill(65)], 'talk.mp3'); const progress: number[] = [];
	const result = await asrUpload(file, fraction => progress.push(fraction));
	expect(result).toEqual({ ok: true, key: 'file:' + 'c'.repeat(32) });
	expect(payloads.map(p => p.mode)).toEqual(['uploadStart', 'uploadChunk', 'uploadChunk', 'uploadChunk', 'uploadFinish']); expect(payloads[0]).toMatchObject({ name: 'talk.mp3', size: file.size });
	expect(payloads.filter(p => p.mode === 'uploadChunk').map(p => p.index)).toEqual([0, 1, 2]); expect(atob(payloads[3].data)).toBe('A'.repeat(10)); expect(progress[progress.length - 1]).toBe(1);
});

it('stops at the first problem and can be cancelled between pieces', async () => {
	send.mockResolvedValueOnce({ ok: false, error: 'no-space' }); expect(await asrUpload(new File(['x'], 'a.mp3'))).toEqual({ ok: false, error: 'no-space' });
	send.mockReset(); send.mockResolvedValueOnce({ ok: true, uploadId: 'a'.repeat(32) }).mockResolvedValueOnce({ ok: false, error: 'bad-request' });
	expect(await asrUpload(new File([new Uint8Array(UPLOAD_CHUNK + 1)], 'a.mp3'))).toEqual({ ok: false, error: 'bad-request' }); expect(send).toHaveBeenCalledTimes(2);
	send.mockReset(); const signal = { cancelled: false }; send.mockResolvedValue({ ok: true, uploadId: 'a'.repeat(32) });
	const pending = asrUpload(new File(['x'], 'a.mp3'), undefined, signal); signal.cancelled = true; expect(await pending).toEqual({ ok: false, error: 'cancelled' });
});

it('knows which files can be handed over', () => {
	expect(['a.mp3', 'B.M4A', 'x.y.wav', 'c.flac', 'd.mp4'].map(n => AUDIO_FILE.test(n))).toEqual([true, true, true, true, true]);
	expect(['a.exe', 'mp3', 'a.mp3.txt', 'a.pdf'].map(n => AUDIO_FILE.test(n))).toEqual([false, false, false, false]);
});
