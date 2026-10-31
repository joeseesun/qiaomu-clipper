// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { prepareChatAttachment, saveChatAttachments, readChatAttachments, readChatAttachmentPreview, deleteChatAttachments, attachmentRefs, MAX_CHAT_FILE_BYTES } from './chat-attachments';

const PNG = 'data:image/png;base64,aGVsbG8=';
beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 600, close: vi.fn() }));
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as any);
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('normalizes uploads to raster image parts and separate thumbnail data, with no network request', async () => {
	const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
	const item = await prepareChatAttachment(new File(['fixture'], 'shot.png', { type: 'image/png' }), new AbortController().signal);
	expect(item.images).toEqual([{ dataUrl: PNG, label: '附件图片：shot.png' }]);
	expect(item.thumbnail).toBe(PNG); expect(fetch).not.toHaveBeenCalled();
	expect(attachmentRefs([item])).toEqual([{ id: item.id, name: 'shot.png' }]);
	expect(JSON.stringify(attachmentRefs([item]))).not.toContain('base64');
});

it('tiles long screenshots without discarding their bottom and releases the decoder', async () => {
	const close = vi.fn(); vi.mocked(createImageBitmap).mockResolvedValue({ width: 1000, height: 6500, close } as any);
	const item = await prepareChatAttachment(new File(['fixture'], 'long.png', { type: 'image/png' }), new AbortController().signal);
	expect(item.images.length).toBeGreaterThan(4);
	expect(item.images[item.images.length - 1].label).toContain(`(${item.images.length}/${item.images.length})`);
	expect(close).toHaveBeenCalledOnce();
});

it('restores saved attachment bytes and previews by reference and actually deletes both', async () => {
	const item = await prepareChatAttachment(new File(['fixture'], 'shot.png', { type: 'image/png' }), new AbortController().signal);
	await saveChatAttachments([item]);
	expect(await readChatAttachmentPreview(item.id)).toBe(PNG);
	expect(await readChatAttachments(attachmentRefs([item]))).toEqual(item.images);
	await deleteChatAttachments([item.id]);
	expect(await readChatAttachmentPreview(item.id)).toBeUndefined();
	await expect(readChatAttachments(attachmentRefs([item]))).rejects.toThrow('shot.png');
});

it('rejects unsupported, oversized, corrupt and canceled images before they can be submitted', async () => {
	await expect(prepareChatAttachment(new File(['no'], 'note.txt', { type: 'text/plain' }), new AbortController().signal)).rejects.toThrow('不支持');
	const large = new File(['large'], 'large.png', { type: 'image/png' }); Object.defineProperty(large, 'size', { value: MAX_CHAT_FILE_BYTES + 1 });
	await expect(prepareChatAttachment(large, new AbortController().signal)).rejects.toThrow('12 MB');
	const abort = new AbortController(); abort.abort();
	await expect(prepareChatAttachment(new File(['x'], 'x.png', { type: 'image/png' }), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
	expect(createImageBitmap).not.toHaveBeenCalled();
	vi.mocked(createImageBitmap).mockRejectedValue(new Error('The source image could not be decoded.'));
	await expect(prepareChatAttachment(new File(['broken'], 'broken.png', { type: 'image/png' }), new AbortController().signal)).rejects.toThrow('读不出来');
});
