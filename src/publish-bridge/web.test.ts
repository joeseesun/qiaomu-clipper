import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), x: vi.fn(), zhihu: vi.fn() }));
vi.mock('../utils/browser-polyfill', () => ({ default: { tabs: { create: fake.create, get: fake.get } } }));
vi.mock('./x', () => ({ runXJob: fake.x }));
vi.mock('./zhihu', () => ({ runZhihuJob: fake.zhihu }));
import { handleWebPublish, validateWebPayload } from './web';
import { allowedPublishPage } from './web-protocol';
import type browser from '../utils/browser-polyfill';
const sender = (id: number, url = 'https://blog.qiaomu.ai/editor', frameId = 0) => ({ tab: { id, url }, url, frameId }) as browser.Runtime.MessageSender;
const article = (target = 'x') => ({ job: { v: 1, id: crypto.randomUUID(), title: '文章', target, content: { markdown: '---\ntitle: 文章\n---\n正文', html: '<p>正文</p>' }, assets: [] }, assets: [] });
beforeEach(() => { vi.clearAllMocks(); fake.create.mockResolvedValue({ id: 100 }); fake.get.mockResolvedValue({ id: 1 }); fake.x.mockResolvedValue(undefined); fake.zhihu.mockResolvedValue(undefined); });
describe('direct browser publishing', () => {
  it('never trusts a foreign host, iframe or missing sender tab', async () => {
    for (const url of ['https://blog.qiaomu.ai.evil.test/editor', 'http://blog.qiaomu.ai/editor', 'https://evil.test/', 'https://user@blog.qiaomu.ai/']) expect(allowedPublishPage(url)).toBe(false);
    expect(await handleWebPublish({ kind: 'start', payload: article() }, sender(1, 'https://evil.test/'))).toMatchObject({ error: expect.any(String) });
    expect(await handleWebPublish({ kind: 'ping' }, sender(1, undefined, 1))).toMatchObject({ error: expect.any(String) });
    expect(fake.create).not.toHaveBeenCalled();
  });
  it('opens the platform using extension APIs and returns the existing adapter receipt without localhost HTTP', async () => {
    fake.x.mockImplementation(async (_tab, _job, client) => { await client.status({ state: 'done', url: 'https://x.com/i/articles/123', text: '草稿已写入' }); });
    expect(await handleWebPublish({ kind: 'ping' }, sender(10))).toEqual({ v: 1 });
    expect(await handleWebPublish({ kind: 'start', payload: article() }, sender(10))).toMatchObject({ ok: true });
    expect(fake.create).toHaveBeenCalledWith({ url: 'https://x.com/compose/articles', active: true });
    expect(await handleWebPublish({ kind: 'status' }, sender(10))).toMatchObject({ state: 'done', url: 'https://x.com/i/articles/123' });
    expect(await handleWebPublish({ kind: 'status' }, sender(11))).toMatchObject({ state: 'error' });
  });
  it('passes complete image bytes to the same Zhihu adapter and propagates cancellation', async () => {
    let client: { cancelled: boolean } | undefined;
    fake.zhihu.mockImplementation(async (_tab, _job, c) => { client = c; expect([...new Uint8Array(await c.asset({ id: 'pic' }))]).toEqual([1,2,3]); });
    const payload = article('zhihu');
    const asset = { id: 'pic', mime: 'image/png', bytes: 3, name: 'pic.png' };
    const withImage = { ...payload, job: { ...payload.job, assets: [asset] }, assets: [{ ...asset, base64: 'AQID' }] };
    expect(validateWebPayload(withImage)).toEqual(withImage);
    expect(await handleWebPublish({ kind: 'start', payload: withImage }, sender(20))).toMatchObject({ ok: true });
    await handleWebPublish({ kind: 'cancel' }, sender(20));
    expect(client?.cancelled).toBe(true);
    expect(await handleWebPublish({ kind: 'status' }, sender(20))).toMatchObject({ state: 'cancelled' });
  });
  it('rejects invalid image bytes, cross-platform jobs and unknown operations', async () => {
    expect(() => validateWebPayload(article('wechat'))).toThrow();
    expect(() => validateWebPayload({ ...article(), assets: [{ id: 'bad', mime: 'image/png', bytes: 999, name: 'bad.png', base64: 'AQID' }] })).toThrow();
    expect(await handleWebPublish({ kind: 'unknown' }, sender(30))).toMatchObject({ error: expect.any(String) });
  });
});

it('accepts MP4 bytes for X but never sends video into the Zhihu image adapter', () => {
  const video = { id: 'video-1', mime: 'video/mp4', bytes: 3, name: 'video-1.mp4' };
  const x = article('x');
  const payload = { ...x, job: { ...x.job, assets: [video] }, assets: [{ ...video, base64: 'AQID' }] };
  expect(validateWebPayload(payload)).toEqual(payload);
  expect(() => validateWebPayload({ ...payload, job: { ...payload.job, target: 'zhihu' } })).toThrow();
  expect(() => validateWebPayload({ ...payload, assets: [{ ...video, bytes: 33 * 1024 * 1024, base64: 'AQID' }] })).toThrow();
});
