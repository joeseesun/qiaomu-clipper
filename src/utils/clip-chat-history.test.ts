// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), resume: vi.fn(), models: true }));
vi.mock('./storage-utils', () => ({ generalSettings: { providers: [] }, getLocalStorage: async () => undefined, setLocalStorage: vi.fn() }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => state.models ? [{ id: 'test', name: 'Test' }] : [] }));
vi.mock('./chat-agent', () => ({ streamChatAgent: (...args: any[]) => state.stream(...args) }));
vi.mock('./chat-history-resume', () => ({ openChatSource: (...args: any[]) => state.resume(...args) }));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
vi.mock('./chat-tools-client', () => ({ chatCapabilities: async () => ({ webEnabled: false }), requestChatTool: vi.fn() }));
import { mountClipChat } from './clip-chat';
import { saveConversation, readConversation, type Conversation } from './chat-history';
const A = 'https://source.test/original', B = 'https://another.test/page';
const saved = (id = 'old'): Conversation => ({ id, title: 'Original question', updatedAt: 0, messages: [{ role: 'user', content: 'Original question' }, { role: 'assistant', content: 'Original answer' }] });
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
let ui: ReturnType<typeof mountClipChat>;
let prepare = vi.fn(async () => {});
beforeEach(() => {
 document.body.replaceChildren(); vi.clearAllMocks(); state.models = true;
 vi.stubGlobal('indexedDB', new IDBFactory()); state.stream.mockImplementation(async (req: any) => req.onText('New answer')); state.resume.mockResolvedValue(undefined);
});
afterEach(() => { ui?.destroy(); vi.unstubAllGlobals(); });
async function mount(url = B) {
 prepare = vi.fn(async () => {});
 ui = mountClipChat({ getContext: () => ({ url, title: 'Live page', markdown: 'LIVE BODY NEVER STORED' }), prepareContext: prepare }); ui.toggle(true);
 await vi.waitFor(() => expect(document.querySelector('.clip-chat-composer textarea')).not.toBeNull()); await flush();
}
async function history() {
 document.querySelector<HTMLButtonElement>('[title=qiaomuChatHistory]')!.click();
 await vi.waitFor(() => expect(document.querySelector('.clip-chat-history-open')).not.toBeNull());
}
async function openFirst() {
 await history(); document.querySelector<HTMLButtonElement>('.clip-chat-history-open')!.click();
 await vi.waitFor(() => expect(document.querySelector<HTMLDivElement>('.clip-chat-history-resume')!.hidden).toBe(false));
}
it('views another page history without reading the source or calling a model and replaces the composer with its link', async () => {
 await saveConversation(A, 'Original page', saved()); await mount(); await openFirst();
 expect(document.querySelector('.clip-chat-messages')!.textContent).toContain('Original answer');
 expect(document.querySelector<HTMLFormElement>('.clip-chat-composer')!.hidden).toBe(true);
 const link = document.querySelector<HTMLAnchorElement>('.clip-chat-history-resume a')!;
 expect(link.textContent).toBe('回到原页面咱们接着聊'); expect(link.href).toBe(A);
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = 'Do not send';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); ui.quote('Do not quote'); await flush();
 expect(prepare).not.toHaveBeenCalled(); expect(state.stream).not.toHaveBeenCalled();
 link.click(); await flush(); expect(state.resume).toHaveBeenCalledWith(expect.objectContaining({ url: A }), 'old');
});
it('returns to the same original page and resumes the selected conversation with fresh context, storing no page body', async () => {
 const c = saved(); await saveConversation(A, 'Original', c); await mount(A); await openFirst();
 document.querySelector<HTMLAnchorElement>('.clip-chat-history-resume a')!.click();
 expect(document.querySelector<HTMLFormElement>('.clip-chat-composer')!.hidden).toBe(false);
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = 'Follow up';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();
 await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
 expect(state.stream.mock.calls[0][0].sessionId).toBe('old'); expect(state.stream.mock.calls[0][0].system).toContain('LIVE BODY NEVER STORED');
 await vi.waitFor(async () => expect((await readConversation(A, 'old'))!.messages).toHaveLength(4));
 expect(JSON.stringify(await readConversation(A, 'old'))).not.toContain('LIVE BODY NEVER STORED');
 expect(state.resume).not.toHaveBeenCalled();
});
it('opens history without configured models and loads long messages in bounded batches without requiring configured models', async () => {
 const c = saved(); c.messages = Array.from({ length: 150 }, (_, i) => [{ role: 'user' as const, content: `Question ${i}` }, { role: 'assistant' as const, content: `Answer ${i}` }]).flat();
 await saveConversation(A, 'Original', c); state.models = false; await mount(); await openFirst();
 expect(document.querySelectorAll('.clip-chat-message')).toHaveLength(40);
 document.querySelector<HTMLButtonElement>('.clip-chat-earlier')!.click();
 expect(document.querySelectorAll('.clip-chat-message')).toHaveLength(80);
 expect(state.stream).not.toHaveBeenCalled();
});
it('does not load remote Markdown/tool images or expose tool retries in read-only history', async () => {
 const c = saved(); c.messages[1].content = '![remote](https://private.test/image)';
 c.messages[1].tools = [{ id: 'tool', call: { type: 'search_web', query: 'test' }, state: 'error', error: 'interrupted' }];
 await saveConversation(A, 'Original', c); await mount(); await openFirst();
 expect(document.querySelectorAll('.clip-chat-messages img[src^="https:"]')).toHaveLength(0);
 expect(Array.from(document.querySelectorAll('.qm-tool-result button'))).toHaveLength(0);
 expect(document.querySelector<HTMLAnchorElement>('.clip-chat-body a')?.href).toBe('https://private.test/image');
});
it('shows save failure instead of silently losing a reply', async () => {
 await mount(); vi.stubGlobal('indexedDB', { open() { throw new Error('Disk full'); } });
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = 'Question';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();
 await vi.waitFor(() => expect(document.querySelector('.is-error')?.textContent).toContain('Disk full'));
 expect(state.stream).not.toHaveBeenCalled();
});

it('bounds model context while retaining every saved message', async () => {
 const c = saved('long'); c.messages = Array.from({ length: 75 }, (_, i) => [{ role: 'user' as const, content: `Q${i}` }, { role: 'assistant' as const, content: `A${i}` }]).flat();
 await saveConversation(A, 'Original', c); await mount(A); await openFirst();
 document.querySelector<HTMLAnchorElement>('.clip-chat-history-resume a')!.click();
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = 'Latest question';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();
 await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
 const request = state.stream.mock.calls[0][0];
 expect(request.messages.length).toBeLessThanOrEqual(41); expect(request.messages[0].role).toBe('user');
 expect(request.system).toContain('most recent conversation turns');
 await vi.waitFor(async () => expect((await readConversation(A, 'long'))!.messages).toHaveLength(152));
});
it('checkpoints a streaming answer to its source when opening another history item', async () => {
 await saveConversation(A, 'Original', saved());
 let release!: () => void;
 state.stream.mockImplementation(async (req: any) => { req.onText('Partial answer on page B'); await new Promise<void>(resolve => { release = resolve; }); });
 await mount(B);
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value = 'Question on B';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();
 await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
 const id = state.stream.mock.calls[0][0].sessionId;
 await history();
 const original = Array.from(document.querySelectorAll<HTMLButtonElement>('.clip-chat-history-open')).find(n => n.textContent?.includes('Original question'))!;
 original.click(); await vi.waitFor(() => expect(document.querySelector<HTMLFormElement>('.clip-chat-composer')!.hidden).toBe(true));
 release();
 await vi.waitFor(async () => expect((await readConversation(B, id))?.messages[1].content).toBe('Partial answer on page B'));
 expect((await readConversation(A, 'old'))!.messages).toHaveLength(2);
});
it('does not leave failed first questions in history and allows retry', async () => {
 state.stream.mockRejectedValueOnce(new Error('Model unavailable'));
 await mount(B); const input = document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;
 const form = document.querySelector<HTMLFormElement>('.clip-chat-composer')!; input.value = 'Try me'; form.requestSubmit();
 await vi.waitFor(() => expect(document.querySelector('.is-error')?.textContent).toContain('Model unavailable'));
 const failedId = state.stream.mock.calls[0][0].sessionId;
 await vi.waitFor(async () => expect(await readConversation(B, failedId)).toBeUndefined());
 form.requestSubmit(); await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(2));
 expect(state.stream.mock.calls[1][0].sessionId).not.toBe(failedId);
 await vi.waitFor(async () => expect((await readConversation(B, state.stream.mock.calls[1][0].sessionId))?.messages).toHaveLength(2));
});
