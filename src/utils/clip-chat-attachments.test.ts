// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const state = vi.hoisted(() => ({ stream: vi.fn(), pageRead: vi.fn(), saved: [] as any[] }));
vi.mock('./storage-utils', () => ({ generalSettings: { providers: [], models: [] }, getLocalStorage: async () => undefined, setLocalStorage: vi.fn() }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'test', name: 'Test' }] }));
vi.mock('./chat-agent', () => ({ streamChatAgent: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({
	loadConversations: async () => structuredClone(state.saved),
	saveConversation: async (_url: string, _title: string, chat: unknown) => { state.saved = [structuredClone(chat)]; },
	deleteConversation: async () => { state.saved = []; }
}));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
vi.mock('./chat-images', async importOriginal => ({ ...(await importOriginal<any>()), ChatImageSession: class { clear() {} read(...args: unknown[]) { return state.pageRead(...args); } } }));
import { mountClipChat } from './clip-chat';

const PNG = 'data:image/png;base64,aGVsbG8=';
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
beforeEach(() => {
	document.body.replaceChildren(); state.saved = []; vi.clearAllMocks();
	vi.stubGlobal('indexedDB', new IDBFactory());
	vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 600, height: 400, close: vi.fn() }));
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as any);
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
	state.pageRead.mockImplementation(async (images: any[]) => ({ images: images.map(image => ({ label: `图 ${image.index}`, dataUrl: PNG })), ready: images.map(image => image.index), failed: [] }));
	state.stream.mockImplementation(async (request: any) => { request.onText('I received the image.'); return 'I received the image.'; });
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const file = (name = 'screenshot.png') => new File(['fixture'], name, { type: 'image/png' });
const input = () => document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;
async function mount(markdown = 'Public test page') {
	const chat = mountClipChat({ getContext: () => ({ title: 'Page', url: 'https://example.com/image-test', markdown }) });
	chat.toggle(true); await flush(); return chat;
}
function paste(files: File[], text = '') {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => text } });
	input().dispatchEvent(event); return event;
}
function send(text = '') { input().value = text; document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); }
const ready = () => vi.waitFor(() => expect(document.querySelector('.clip-chat-attachments[aria-busy=true]')).toBeNull());

it('accepts a pasted screenshot, submits image-only, carries it on follow-up and restores it after reopening', async () => {
	let chat = await mount(); expect(paste([file()]).defaultPrevented).toBe(true); await ready();
	expect(document.querySelector('.clip-chat-attachment img')?.getAttribute('src')).toBe(PNG);
	expect(state.stream).not.toHaveBeenCalled();
	send(); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(1));
	expect(state.stream.mock.calls[0][0].messages[0]).toMatchObject({ content: '请分析所附图片。', images: [{ dataUrl: PNG }] });
	await vi.waitFor(() => expect(state.saved[0]?.messages).toHaveLength(2));
	expect(JSON.stringify(state.saved)).not.toContain('base64');
	send('What was the code?'); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(2));
	expect(state.stream.mock.calls[1][0].messages[0].images[0].dataUrl).toBe(PNG);
	await vi.waitFor(() => expect(state.saved[0]?.messages).toHaveLength(4));
	chat.destroy(); chat = await mount();
	await vi.waitFor(() => expect(document.querySelector('.clip-chat-sent-attachments img')?.getAttribute('src')).toBe(PNG));
	send('Check the same image again'); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(3));
	expect(state.stream.mock.calls[2][0].messages[0].images[0].dataUrl).toBe(PNG); chat.destroy();
});

it('accepts picker and dropped files, removes a thumbnail and preserves text in a mixed paste', async () => {
	await mount();
	const picker = document.querySelector<HTMLInputElement>('.clip-chat-file-input')!;
	Object.defineProperty(picker, 'files', { value: [file('picked.png')] }); picker.dispatchEvent(new Event('change'));
	const event = new Event('drop', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'dataTransfer', { value: { files: [file('dropped.png')] } });
	document.querySelector('.clip-chat')!.dispatchEvent(event); await ready();
	expect(event.defaultPrevented).toBe(true);
	expect(document.querySelectorAll('.clip-chat-attachment')).toHaveLength(2);
	document.querySelector<HTMLButtonElement>('[aria-label="移除附件 picked.png"]')!.click();
	input().value = 'Before after'; input().setSelectionRange(7, 7); paste([file('paste.png')], 'middle '); await ready();
	expect(input().value).toBe('Before middle after');
	send('Read both'); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	const images = state.stream.mock.calls[0][0].messages[0].images;
	expect(images.map((image: any) => image.label)).toEqual(['附件图片：dropped.png', '附件图片：paste.png']);
});

it('waits for decoding on immediate send and prevents double submission', async () => {
	await mount(); let decode!: (value: unknown) => void;
	vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { decode = resolve as any; }));
	paste([file()]); send('Read it'); send('Duplicate'); await flush(); expect(state.stream).not.toHaveBeenCalled();
	decode({ width: 600, height: 400, close() {} });
	await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	expect(state.stream.mock.calls[0][0].messages[0].content).toBe('Read it');
});

it('blocks invalid attachments instead of silently sending text-only and can retry a rejected image request', async () => {
	await mount(); paste([new File(['bad'], 'bad.txt', { type: 'text/plain' })]); await ready();
	send('Read my image'); await flush(); expect(state.stream).not.toHaveBeenCalled();
	expect(document.querySelector('.clip-chat-attachment-error')?.textContent).toContain('不支持');
	document.querySelector<HTMLButtonElement>('[aria-label="移除附件 bad.txt"]')!.click();
	paste([file()]); await ready(); state.stream.mockRejectedValueOnce(new Error('Image request rejected'));
	send('Read my image'); await vi.waitFor(() => expect(document.querySelector('.is-error')?.textContent).toContain('Image request rejected'));
	expect(input().value).toBe('Read my image'); expect(document.querySelectorAll('.clip-chat-attachment')).toHaveLength(1);
	send('Retry'); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(2));
	expect(state.stream.mock.calls[1][0].messages[0].images[0].dataUrl).toBe(PNG);
});

it('respects text-only page selection alongside attachments and cancels decoding on new conversation', async () => {
	await mount('![unrelated](https://example.com/photo.png)');
	Array.from(document.querySelectorAll<HTMLButtonElement>('.clip-chat-image-tools button')).find(b => b.textContent === '仅正文')!.click();
	paste([file()]); await ready(); send('Read the upload');
	await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	expect(state.stream.mock.calls[0][0].messages[0].images).toHaveLength(1);
	await vi.waitFor(() => expect(state.saved[0]?.messages).toHaveLength(2));
	let decode!: (value: unknown) => void;
	vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { decode = resolve as any; }));
	paste([file('canceled.png')]); await flush();
	document.querySelector<HTMLButtonElement>('[title=qiaomuChatNew]')!.click();
	decode({ width: 600, height: 400, close() {} }); await flush();
	expect(document.querySelectorAll('.clip-chat-attachment')).toHaveLength(0);
	expect(state.stream).toHaveBeenCalledOnce();
});

it('reserves attachment slots across rapid paste events and requires removal of a rejected file before sending', async () => {
	await mount();
	paste([file('1.png'), file('2.png'), file('3.png')]);
	paste([file('4.png'), file('5.png'), file('6.png'), file('7.png')]); await ready();
	expect(document.querySelectorAll('.clip-chat-attachment')).toHaveLength(6);
	expect(document.querySelector('.clip-chat-attachment-error')?.textContent).toContain('7.png');
	send('Read all'); await flush(); expect(state.stream).not.toHaveBeenCalled();
	document.querySelector<HTMLButtonElement>('[aria-label="移除附件 7.png"]')!.click();
	send('Read six'); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	expect(state.stream.mock.calls[0][0].messages[0].images).toHaveLength(6);
});

it('restores attachments on stop and uses fresh IDs when retrying while old history is cleaned up', async () => {
	await mount(); paste([file()]); await ready();
	state.stream.mockImplementationOnce((request: any) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Stop', 'AbortError')))));
	send(); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	const previous = state.saved[0].messages[0].attachments[0].id;
	document.querySelector<HTMLButtonElement>('.clip-chat-send')!.click();
	await vi.waitFor(() => expect(document.querySelectorAll('.clip-chat-attachment')).toHaveLength(1));
	send(); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(2));
	expect(state.saved[0].messages[0].attachments[0].id).not.toBe(previous);
	expect(state.stream.mock.calls[1][0].messages[0].images[0].dataUrl).toBe(PNG);
});

// Uploaded files supplement the existing page-image selection; neither source replaces the other.
it('sends selected webpage images together with uploaded attachments and preserves both source labels', async () => {
 await mount('![page](https://example.com/photo.png)');
 paste([file('upload.png')]); await ready(); send('Compare these images');
 await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
 const request = state.stream.mock.calls[0][0];
 expect(request.messages[0].images.map((image: any) => image.label)).toEqual(['附件图片：upload.png', '图 1']);
 expect(request.system).toContain('本次实际提供图 1');
 expect(request.system).not.toContain('原网页图片未自动提供');
 await vi.waitFor(() => expect(state.saved[0]?.messages).toHaveLength(2));
 expect(state.saved[0].messages[0].imageNumbers).toEqual([1]);
 expect(state.saved[0].messages[0].attachments).toHaveLength(1);
 expect(JSON.stringify(state.saved)).not.toContain('base64');
});

it('reports a missing older attachment instead of silently omitting its conversation turn', async () => {
 state.saved = [{ id: 'long', title: 'Long chat', updatedAt: 1, messages: [
  { role: 'user', content: 'Old upload', attachments: [{ id: 'chat-image-00000000-0000-4000-8000-000000000001', name: 'missing-old.png' }] },
  ...Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }))
 ] }];
 await mount(); send('Recent question');
 await vi.waitFor(() => expect(document.querySelector('.clip-chat-message.is-error')?.textContent).toContain('missing-old.png'));
 expect(state.stream).not.toHaveBeenCalled();
 expect(state.saved[0].messages[0].content).toBe('Old upload');
 expect(state.saved[0].messages[0].attachments[0].name).toBe('missing-old.png');
});
