// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

let models: any[] = [];
const generate = vi.fn(async (_config: any, _prompt: string, _aspect: string, _signal?: any, _model?: string) => new Blob(['png-bytes'], { type: 'image/png' }));
vi.mock('../image-models', () => ({
	ASPECTS: ['16:9', '1:1'], loadImageModels: async () => ({ models, defaultId: models[0]?.id ?? '' }), readyModels: (s: any) => s.models, modelsOf: (m: any) => m.models ?? [m.model], serviceName: (m: any) => m.name ?? 'Service',
	imageModelName: (_m: any, id: string) => id,
	generateImage: (...args: [any, string, string, any, string]) => generate(...args),
}));
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));
const listeners = new Set<() => void>();
import { ImageJobRunner } from '../../utils/image-job-runner';
import { listImageJobs } from '../../utils/image-library-store';
let runner: ImageJobRunner;
vi.mock('../../utils/image-jobs', () => ({
 submitImageJob: async (request: any) => runner.enqueue({ job: { ...request, state: 'queued', created: Date.now(), modelLabel: 'Images' }, config: models.find(m => m.id === request.configId) }),
 cancelImageJob: async (id: string) => runner.cancel(id),
 watchImageJobs: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, imageJobLabel: (state: string) => state, openImageLibrary: vi.fn(),
}));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: vi.fn(async () => ({})) }, runtime: { getURL: (p: string) => p } } }));
(URL as any).createObjectURL = () => 'blob:fake'; (URL as any).revokeObjectURL = () => {};

import browser from '../../utils/browser-polyfill';
import { resetDbConnection } from '../db';
import { getImage } from '../images';
import { describeImageError, openImageDialog } from './image-dialog';

beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('createImageBitmap', async () => ({ width: 1024, height: 1024, close() {} })); listeners.clear(); runner = new ImageJobRunner(() => listeners.forEach(fn => fn())); (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); document.body.textContent = ''; generate.mockClear(); models = [{ id: 'm', model: 'gpt-image-1' }]; if (!(HTMLDialogElement.prototype as any).showModal) { (HTMLDialogElement.prototype as any).showModal = function () { this.open = true; }; (HTMLDialogElement.prototype as any).close = function () { this.open = false; }; } });
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(b => b.textContent === label)!;

it('points to the settings when no picture model is set up', async () => {
	models = [];
	await openImageDialog({ applies: [] });
	expect(document.querySelector('dialog')!.textContent).toContain('还没有可用的生图模型');
	button('去添加生图模型').click();
	expect((browser.tabs.create as any)).toHaveBeenCalledWith({ url: 'settings.html?section=image-models' });
	expect(document.querySelector('dialog')).toBeNull();
});

it('makes a picture from the description and stores it only when the writer accepts it', async () => {
	const applied: { id: string; prompt: string }[] = [];
	await openImageDialog({ prompt: '雨后的山', aspect: '1:1', applies: [{ label: '插入文章', run: (id, prompt) => { applied.push({ id, prompt }); } }] });
	expect(button('插入文章').hidden).toBe(true);
	button('生成').click(); await vi.waitFor(() => expect(document.querySelector('.qw-image-preview img')).not.toBeNull());
	expect(generate).toHaveBeenCalledWith(models[0], '雨后的山', '1:1', expect.anything(), 'gpt-image-1', undefined);
	expect(document.querySelector('.qw-image-preview img')).not.toBeNull();
	expect(button('插入文章').hidden).toBe(false);
	button('插入文章').click();
	await vi.waitFor(() => expect(applied.length).toBe(1));
	expect(applied[0].prompt).toBe('雨后的山');
	expect((await getImage(applied[0].id))?.mime).toBe('image/png');
	expect(document.querySelector('dialog')).toBeNull();
});

it('asks for a description first and explains failures in plain words', async () => {
	await openImageDialog({ applies: [] });
	button('生成').click(); await settle();
	expect(document.querySelector('dialog [role=status]')!.textContent).toContain('先写下想要的画面');
	expect(generate).not.toHaveBeenCalled();
	expect(describeImageError(new Error('HTTP 401'))).toContain('密钥无效');
	expect(describeImageError(new Error('HTTP 429'))).toContain('额度');
	expect(describeImageError(new Error('empty-image'))).toContain('没有返回图片');
	expect(describeImageError(new Error('service-error: 不支持的参数: size'))).toBe('服务拒绝了这次请求：不支持的参数: size');
	expect(describeImageError(new Error('HTTP 400: content policy'))).toContain('content policy');
});

it('lets the writer pick any model of any connected service, and uses that one', async () => {
	models = [{ id: 'm', name: 'OpenAI', model: 'gpt-image-1', models: ['gpt-image-1', 'gpt-image-2'] }, { id: 'n', name: 'Seedream', model: 'seedream-5', models: ['seedream-5'] }];
	await openImageDialog({ prompt: '猫', applies: [] });
	const select = document.querySelector<HTMLSelectElement>('dialog select[aria-label="生图模型"]')!;
	expect(Array.from(select.querySelectorAll('optgroup')).map(g => [g.label, g.querySelectorAll('option').length])).toEqual([['OpenAI', 2], ['Seedream', 1]]);
	select.value = select.querySelectorAll('option')[1].value;
	button('生成').click(); await vi.waitFor(() => expect(document.querySelector('.qw-image-preview img')).not.toBeNull());
	expect(generate).toHaveBeenCalledWith(models[0], '猫', '16:9', expect.anything(), 'gpt-image-2', undefined);
	select.value = select.querySelectorAll('option')[2].value;
	button('重新生成').click(); await settle();
	expect(generate).toHaveBeenLastCalledWith(models[1], '猫', '16:9', expect.anything(), 'seedream-5', undefined);
});

it('closing the generation dialog preserves the background job', async () => {
 let finish!: (blob: Blob) => void;
 generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 await openImageDialog({ prompt: '山', applies: [] }); button('生成').click();
 await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
 const signal = generate.mock.calls[0][3];
 button('移到后台').click(); expect(signal.aborted).toBe(false);
 finish(new Blob(['png'], { type: 'image/png' }));
 await vi.waitFor(async () => expect((await listImageJobs())[0].state).toBe('ready'));
 expect(document.querySelector('dialog')).toBeNull();
});
