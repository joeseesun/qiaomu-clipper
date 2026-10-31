// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ models: [] as any[], listeners: new Set<() => void>(), generate: vi.fn(), stream: vi.fn(), tool: vi.fn() }));
vi.mock('../../utils/chat-llm', () => ({
	enabledChatModels: () => [{ id: 'm1', name: 'Chat', providerModelId: 'qa-chat' }], streamChat: (...args: any[]) => state.stream(...args),
}));
vi.mock('../../utils/storage-utils', () => ({ generalSettings: { providers: [] }, getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));
vi.mock('../image-models', async original => ({
	...await original<any>(), loadImageModels: async () => ({ models: state.models, defaultId: 'pictures' }),
	generateImage: (...args: any[]) => state.generate(...args),
}));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: vi.fn() }, runtime: { getURL: (s: string) => s } } }));
vi.mock('../../utils/chat-tools-client', () => ({ chatCapabilities: async () => ({ web: true, webEnabled: true, webProvider: 'deepseek', images: true, fetch: true }), requestChatTool: (...a: any[]) => state.tool(...a), downloadChatPhoto: async () => new Blob(['search-photo'], { type: 'image/png' }) }));
import { ImageJobRunner } from '../../utils/image-job-runner';
let runner: ImageJobRunner;
vi.mock('../../utils/image-jobs', () => ({
	submitImageJob: async (request: any) => runner.enqueue({ job: { ...request, created: Date.now(), state: 'queued', modelLabel: 'Images' }, config: state.models[0] }),
	cancelImageJob: (id: string) => runner.cancel(id),
	watchImageJobs: (fn: () => void) => { state.listeners.add(fn); return () => state.listeners.delete(fn); },
	imageJobLabel: (s: string) => s, openImageLibrary: vi.fn(),
}));
import { resetDbConnection } from '../db';
import { buildExtensions } from '../editor/extensions';
import { editorMarkdown } from '../markdown-io';
import { mountChatPanel } from './chat-panel';
import { loadChat } from './chat-store';
import { readImageJob } from '../../utils/image-library-store';
import { imageIdFromUrl, getImage } from '../images';

const reply = '正在为你生成。\n```qm-action\n{"type":"image","prompt":"窗边看书的猫","where":"end","aspect":"1:1"}\n```';
let editor: Editor, panel: ReturnType<typeof mountChatPanel>;
const send = async (text: string) => {
	document.querySelector<HTMLTextAreaElement>('.qw-chat-input')!.value = text;
	document.querySelector<HTMLButtonElement>('button[title="发送"]')!.click();
};
const mount = async () => {
	panel = mountChatPanel({ editor, articleId: 'image-chat', getTitle: () => '猫', setTitle: vi.fn(), getDigest: () => '', setDigest: vi.fn(), getMarkdown: () => editorMarkdown(editor) });
	await panel.toggle(true);
};
beforeEach(async () => {
	vi.stubGlobal('indexedDB', new IDBFactory()); resetDbConnection(); vi.clearAllMocks(); state.listeners.clear();
	vi.stubGlobal('Blob', NodeBlob);
	vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1024, close() {} })));
	URL.createObjectURL = vi.fn(() => 'blob:picture'); URL.revokeObjectURL = vi.fn();
	(Range.prototype as any).getClientRects = () => Object.assign([], { item: () => null });
	(Range.prototype as any).getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
	document.body.replaceChildren();
	state.models = [{ id: 'pictures', name: 'Images', sourceId: 'custom', engine: 'api', baseUrl: 'https://images.test/v1', apiKey: 'test-key', model: 'image-one', models: ['image-one'] }];
	runner = new ImageJobRunner(() => state.listeners.forEach(fn => fn()));
	state.generate.mockResolvedValue(new Blob(['picture'], { type: 'image/png' }));
	state.stream.mockImplementation(async (options: any) => options.onDelta(reply));
	editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: '保留原文。' });
	await mount();
});
afterEach(() => { panel.destroy(); editor.destroy(); vi.unstubAllGlobals(); });

it('generates inline from a request, keeps article edits separate and restores the same picture', async () => {
	await send('给这篇文章生成一张猫的配图');
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')?.hidden).toBe(false));
	expect(state.generate).toHaveBeenCalledTimes(1);
	expect(document.querySelector('dialog')).toBeNull();
	expect(document.querySelector('.qw-prop-apply')).toBeNull();
	expect(editorMarkdown(editor)).toBe('保留原文。');
	const saved = (await loadChat('image-chat'))[0].messages[1].generatedImages![0];
	expect(saved.jobId).toBeTruthy(); expect(saved.imageId).toBeTruthy();
	const insert = Array.from(document.querySelectorAll<HTMLButtonElement>('.clip-chat-generated button')).find(b => b.textContent === '插入文章')!;
	insert.click();
	await vi.waitFor(() => expect(editor.getJSON().content!.some(n => n.type === 'image')).toBe(true));
	const src = editor.getJSON().content!.find(n => n.type === 'image')!.attrs!.src;
	expect(await getImage(imageIdFromUrl(src)!)).toBeDefined();
	panel.destroy(); await mount();
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')?.hidden).toBe(false));
	expect(state.generate).toHaveBeenCalledTimes(1);
});

it('finishes in the background after the writer chat closes, and recovers without resubmitting', async () => {
	let finish!: (blob: Blob) => void;
	state.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
	await send('生成一张配图');
	await vi.waitFor(() => expect(state.generate).toHaveBeenCalledTimes(1));
	const jobId = (await loadChat('image-chat'))[0].messages[1].generatedImages![0].jobId!;
	panel.destroy();
	finish(new Blob(['done'], { type: 'image/png' }));
	await vi.waitFor(async () => expect((await readImageJob(jobId))?.state).toBe('ready'));
	await mount();
	await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('.clip-chat-generated img')?.hidden).toBe(false));
	expect(state.generate).toHaveBeenCalledTimes(1);
});

it('ignores a late image command after switching to a new conversation', async () => {
	let finish!: () => void;
	state.stream.mockImplementation(async (options: any) => { await new Promise<void>(resolve => { finish = resolve; }); options.onDelta(reply); });
	await send('生成图片');
	await vi.waitFor(() => expect(state.stream).toHaveBeenCalledTimes(1));
	document.querySelector<HTMLButtonElement>('button[title="新对话"]')!.click();
	finish();
	await new Promise(resolve => setTimeout(resolve, 30));
	expect(state.generate).not.toHaveBeenCalled();
	expect(document.querySelector('.clip-chat-generated')).toBeNull();
});

it('shows searched landscape photos inline without generation and retains them across history restoration', async () => {
 const photo = { id: 'landscape-1', thumb: 'https://images.unsplash.com/one', full: 'https://images.unsplash.com/one', author: 'Photo Author', link: 'https://unsplash.com/photos/one', description: 'Mountain landscape', download: '/photos/one/download' };
 state.tool.mockResolvedValue({ photos: [photo] });
 state.stream.mockImplementationOnce(async (o: any) => o.onDelta('```qm-tool\n{"type":"search_images","query":"landscape scenery","label":"风景"}\n```')).mockImplementationOnce(async (o: any) => o.onDelta('找到这些照片。'));
 await send('帮我找几张风景图');
 await vi.waitFor(() => expect(document.querySelector('.qm-photo-grid img')).not.toBeNull());
 await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.qw-chat-send[title="发送"]')!.hidden).toBe(false));
 expect(state.generate).not.toHaveBeenCalled(); expect(editorMarkdown(editor)).toBe('保留原文。');
 state.stream.mockImplementationOnce(async (o: any) => o.onDelta('```qm-tool\n{"type":"use_image","id":"landscape-1","action":"insert"}\n```')).mockImplementationOnce(async (o: any) => o.onDelta('已插入。'));
 await send('用第一张');
 await vi.waitFor(() => expect(editor.getJSON().content!.some(n => n.type === 'image')).toBe(true));
 expect(editorMarkdown(editor)).toContain('Photo Author');
 await vi.waitFor(async () => expect((await loadChat('image-chat'))[0].messages).toHaveLength(4));
 panel.destroy(); await mount(); expect(document.querySelector('.qm-photo-credit')?.textContent).toContain('Photo Author'); expect(state.tool).toHaveBeenCalledTimes(1);
});
