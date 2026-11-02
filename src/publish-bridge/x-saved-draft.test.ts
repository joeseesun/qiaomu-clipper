import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ reload: vi.fn(), execute: vi.fn(), result: { ok: true, summary: { bodyMediaExpected: 2, url: 'https://x.com/compose/articles/edit/123' } } }));
vi.mock('../utils/browser-polyfill', () => ({ default: { tabs: { reload: fake.reload, update: vi.fn(async () => ({})) }, scripting: { executeScript: fake.execute } } }));
vi.mock('../x-publish/driver', () => ({ connect: async () => ({ disconnect: () => {} }), injectEngine: async () => {} }));
vi.mock('./relay', async original => ({ ...await original<typeof import('./relay')>(), waitForTab: async () => {}, sendAssets: async () => {}, relayPort: async () => fake.result }));
import { runXJob } from './x';
import type { BridgeJob } from './protocol';
const job: BridgeJob = { v: 1, id: 'test', target: 'x', title: 'test', noteName: 'test', content: { markdown: 'body' }, assets: [] };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
it('refuses a success receipt when the reloaded saved page is missing a media block', async () => {
  fake.execute.mockResolvedValue([{ result: { text: '完整正文', media: 1 } }]);
  const client = { cancelled: false, asset: vi.fn(), status: vi.fn(async () => {}) };
  const running = runXJob(12, job, client);
  await vi.runAllTimersAsync(); await running;
  expect(fake.reload).toHaveBeenCalledWith(12);
  expect(client.status).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error' }));
});
it('reports success only after the reloaded page has all media and no placeholders', async () => {
  fake.execute.mockResolvedValue([{ result: { text: '完整正文', media: 2 } }]);
  const client = { cancelled: false, asset: vi.fn(), status: vi.fn(async () => {}) };
  const running = runXJob(12, job, client);
  await vi.runAllTimersAsync(); await running;
  expect(client.status).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'done' }));
});
