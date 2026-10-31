// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const { storage, settings } = vi.hoisted(() => ({ storage: {} as Record<string, any>, settings: { providers: [] as any[] } }));
vi.mock('../utils/storage-utils', () => ({ getLocalStorage: async (k: string) => storage[k], setLocalStorage: async (k: string, v: unknown) => { storage[k] = structuredClone(v); }, generalSettings: settings, saveSettings: async () => {} }));
vi.mock('../utils/browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => p } } }));
import { initializeImageModelSettings } from './image-model-settings';

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const click = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text || b.title === text)!.click();
const fields = () => Array.from(document.querySelectorAll<HTMLInputElement>('dialog input'));
const saved = () => storage.qiaomuImageModels.models[0];
const open = async () => { await initializeImageModelSettings(); };
beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  settings.providers = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '<section id="image-models-section"><div id="image-models-home"></div></section>';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

it.each(['local', 'oauth'])('shows built-in ImageGen without a chat model catalog for %s Codex', async kind => {
  settings.providers = [{ id: 'codex-account', name: 'Codex', oauth: { kind: 'codex' } }];
  if (kind === 'oauth') storage.qiaomuImageModels = { defaultId: 'old', models: [{ id: 'old', sourceId: 'account:codex-account', engine: 'oauth', providerId: 'codex-account', name: '', baseUrl: '', apiKey: '', model: 'gpt-5.6-sol', models: ['gpt-5.6-sol'], catalog: { baseUrl: '', models: [{ id: 'codex-auto-review' }] } }] };
  await open();
  if (kind === 'oauth') click('编辑');
  else { click('添加生图服务'); Array.from(document.querySelectorAll<HTMLButtonElement>('.im-source')).find(b => b.textContent?.includes('本机 Codex'))!.click(); }
  expect(document.querySelector('dialog')!.textContent).toContain('内置 ImageGen');
  expect(document.querySelector('dialog')!.textContent).not.toMatch(/gpt-5|auto-review|获取可用模型/);
  expect(document.querySelector('.im-models')).toBeNull();
  expect(document.querySelector('dialog input[placeholder="搜索或直接输入模型名，回车添加"]')).toBeNull();
  click('保存'); await settle();
  expect(saved()).toMatchObject({ model: 'imagegen', models: ['imagegen'] });
  if (kind === 'oauth') expect(saved().agentModel).toBe('gpt-5.6-sol');
  expect(document.querySelector('.write-meta')!.textContent).toBe('内置 ImageGen');
});

it('adds a self-hosted Jimeng service with an editable URL and the existing default model', async () => {
  await open(); click('添加生图服务');
  Array.from(document.querySelectorAll<HTMLButtonElement>('.im-source')).find(b => b.textContent?.includes('即梦（自部署）'))!.click();
  expect(document.querySelector('details')!.open).toBe(true);
  click('保存'); expect(document.querySelector('[role=alert]')!.textContent).toContain('接口地址');
  const [key, , base] = fields(); key.value = 'test-key'; base.value = 'https://self.example/v1';
  click('保存'); await settle();
  expect(saved()).toMatchObject({ engine: 'jimeng', sourceId: 'jimeng', baseUrl: 'https://self.example/v1', apiKey: 'test-key', model: 'jimeng-4.5' });
});

it('refreshes future models, preserves selections and saves the last successful catalog across reopening', async () => {
  storage.qiaomuImageModels = { defaultId: 'old', models: [{ id: 'old', sourceId: 'jimeng', engine: 'jimeng', name: '我的', baseUrl: 'https://self.example/v1', apiKey: 'test-key', model: 'jimeng-4.5', models: ['jimeng-4.5', 'jimeng-4.0'] }] };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'jimeng-9.0', type: 'image' }, { id: 'jimeng-video-future', type: 'video' }] })));
  vi.stubGlobal('fetch', fetcher);
  await open(); click('编辑'); click('获取可用模型'); await settle();
  expect(document.querySelector('.im-models')!.textContent).toContain('jimeng-9.0');
  expect(document.querySelector('.im-models')!.textContent).not.toContain('video');
  expect(document.querySelector('.im-chips')!.firstElementChild!.textContent).toContain('jimeng-4.5');
  fetcher.mockRejectedValueOnce(new Error('offline'));
  click('获取可用模型'); await settle();
  expect(document.querySelector('[role=status]')!.textContent).toContain('offline');
  expect(document.querySelector('.im-models')!.textContent).toContain('jimeng-9.0');
  click('保存'); await settle();
  expect(saved().models).toEqual(['jimeng-4.5', 'jimeng-4.0']);
  expect(storage.qiaomuImageModels.defaultId).toBe('old');
  expect(saved().catalog.models.map((m: any) => m.id)).toEqual(['jimeng-9.0']);
  click('编辑');
  expect(document.querySelector('.im-models')!.textContent).toContain('jimeng-9.0');
  const search = fields()[1]; search.value = 'jimeng-manual'; search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  click('保存'); await settle();
  expect(saved().models).toEqual(['jimeng-4.5', 'jimeng-4.0', 'jimeng-manual']);
});

it('discards late model responses when the endpoint changes or the dialog is closed', async () => {
  storage.qiaomuImageModels = { defaultId: 'old', models: [{ id: 'old', sourceId: 'jimeng', engine: 'jimeng', name: '', baseUrl: 'https://first.example/v1', apiKey: 'test-key', model: 'jimeng-4.5', models: ['jimeng-4.5'] }] };
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
  await open(); click('编辑'); click('获取可用模型');
  const base = fields()[2]; base.value = 'https://second.example/v1'; base.dispatchEvent(new Event('input'));
  finish(new Response(JSON.stringify({ data: [{ id: 'jimeng-stale', type: 'image' }] }))); await settle();
  expect(document.querySelector('.im-models')!.textContent).not.toContain('jimeng-stale');
  click('获取可用模型'); click('取消');
  finish(new Response(JSON.stringify({ data: [{ id: 'jimeng-stale', type: 'image' }] }))); await settle();
  expect(document.querySelector('dialog')).toBeNull();
  expect(saved().baseUrl).toBe('https://first.example/v1');
});
