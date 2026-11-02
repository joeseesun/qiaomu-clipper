import browser from '../utils/browser-polyfill';
import type { BridgeAsset, BridgeJob, BridgeStatus } from './protocol';
import type { PublishClient } from './client';
import { runXJob } from './x';
import { runZhihuJob } from './zhihu';
import { allowedPublishPage, WEB_PUBLISH_ACTION } from './web-protocol';

interface AssetInput extends BridgeAsset { base64: string }
interface WebPayload { job: BridgeJob; assets: AssetInput[] }
const landing = { x: 'https://x.com/compose/articles', zhihu: 'https://zhuanlan.zhihu.com/write' };
const jobs = new Map<number, { id: string; client: PublishClient; progress: BridgeStatus; deadline: number; tabId?: number }>();

export function validateWebPayload(input: unknown): WebPayload {
  const payload = input as WebPayload;
  const job = payload?.job;
  if (!job || job.v !== 1 || !Object.prototype.hasOwnProperty.call(landing, job.target) || typeof job.id !== 'string' || job.id.length > 100 || typeof job.title !== 'string' || !job.title.trim() || job.title.length > 1000 || !job.content || !Array.isArray(job.assets) || !Array.isArray(payload.assets) || payload.assets.length > 100) throw new Error('文章格式无效');
  const body = job.target === 'x' ? job.content.markdown : job.content.html;
  if (typeof body !== 'string' || !body.trim() || body.length > 2_000_000) throw new Error('正文为空或过长');
  const ids = new Set<string>(); let total = 0;
  for (const asset of payload.assets) {
    if (!asset || !/^[\w-]{1,100}$/.test(asset.id) || ids.has(asset.id) || !(/^image\/(png|jpeg|webp|gif)$/.test(asset.mime) || (job.target === 'x' && asset.mime === 'video/mp4')) || typeof asset.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64) || asset.base64.length > (asset.mime === 'video/mp4' ? 45_000_000 : 28_000_000) || (total += asset.base64.length) > 56_000_000 || typeof asset.name !== 'string' || asset.name.length > 200) throw new Error('媒体格式无效或过大');
    ids.add(asset.id);
    if (asset.bytes > (asset.mime === 'video/mp4' ? 32 : 20) * 1024 * 1024 || atob(asset.base64).length !== asset.bytes) throw new Error('图片资源不完整');
  }
  if (job.assets.length !== ids.size || job.assets.some(asset => !ids.has(asset.id)) || (job.content.cover && !ids.has(job.content.cover))) throw new Error('图片资源不完整');
  return payload;
}

export async function handleWebPublish(request: unknown, sender: browser.Runtime.MessageSender): Promise<unknown> {
  const message = request as { kind: string; payload?: unknown };
  if (!sender.tab?.id || sender.frameId !== 0 || !allowedPublishPage(sender.url) || !allowedPublishPage(sender.tab.url)) return { error: '发布来源无效' };
  const source = sender.tab.id;
  if (message.kind === 'ping') return { v: 1 };
  for (const [id, entry] of jobs) if (Date.now() > entry.deadline || (id !== source && entry.progress.state !== 'running')) { entry.client.cancelled = true; jobs.delete(id); }
  const current = jobs.get(source);
  if (message.kind === 'status') return current ? current.progress : { state: 'error', text: '浏览器发布连接已结束，请重新发送。' };
  if (message.kind === 'cancel') {
    if (current) { current.client.cancelled = true; current.progress = { state: 'cancelled', text: '已停止；已写入的部分草稿会保留。' }; }
    return { ok: true };
  }
  if (message.kind !== 'start') return { error: '未知操作' };
  if (current?.progress.state === 'running') return { error: '这篇文章正在发送，请等待或停止后重试。' };
  if (current) jobs.delete(source);
  if (jobs.size >= 3) return { error: '正在发送的文章过多，请稍后重试。' };
  const payload = validateWebPayload(message.payload);
  const files = new Map(payload.assets.map(asset => [asset.id, asset]));
  const client: PublishClient = {
    cancelled: false,
    async asset(asset: BridgeAsset) { const file = files.get(asset.id); if (!file) throw new Error('图片资源缺失'); return Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)).buffer; },
    async status(status: BridgeStatus) {
      const entry = jobs.get(source);
      if (!entry || entry.client !== client) { client.cancelled = true; return; }
      if (Date.now() > entry.deadline) { client.cancelled = true; entry.progress = { state: 'error', text: '发送超时，请检查平台草稿后重试。' }; return; }
      if (entry.progress.state !== 'running') return;
      entry.progress = status.state === 'running' ? { ...entry.progress, ...status } : status;
      // A real extension API call on each adapter heartbeat also keeps the MV3 worker alive.
      try { await browser.tabs.get(source); } catch { client.cancelled = true; }
    },
  };
  const entry = { id: payload.job.id, client, progress: { state: 'running', text: '正在打开平台编辑器…' } as BridgeStatus, deadline: Date.now() + 9 * 60_000, tabId: undefined as number | undefined };
  jobs.set(source, entry);
  try {
    const tab = await browser.tabs.create({ url: landing[payload.job.target as 'x' | 'zhihu'], active: true });
    if (!tab.id) throw new Error('无法打开平台编辑器');
    entry.tabId = tab.id;
    void (payload.job.target === 'x' ? runXJob(tab.id, payload.job, client) : runZhihuJob(tab.id, payload.job, client)).finally(() => files.clear());
    return { ok: true, id: entry.id };
  } catch (error) { jobs.delete(source); throw error; }
}

export function registerWebPublish(): void {
  browser.runtime.onMessage.addListener((request: unknown, sender: browser.Runtime.MessageSender) => {
    if ((request as { action?: string })?.action !== WEB_PUBLISH_ACTION) return undefined;
    return handleWebPublish(request, sender).catch(error => ({ error: error instanceof Error ? error.message : '发送失败' }));
  });
  browser.tabs.onRemoved.addListener(tabId => {
    for (const [source, entry] of jobs) if (source === tabId || entry.tabId === tabId) { entry.client.cancelled = true; if (source === tabId) jobs.delete(source); else entry.progress = { state: 'error', text: '平台窗口已关闭，请重新发送。' }; }
  });
}
