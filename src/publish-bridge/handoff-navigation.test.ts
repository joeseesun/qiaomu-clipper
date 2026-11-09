import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  listen: vi.fn(), get: vi.fn(), update: vi.fn(), execute: vi.fn(),
  fetchJob: vi.fn(), status: vi.fn(),
  xhs: vi.fn(), x: vi.fn(), zhihu: vi.fn(),
}));
vi.mock('../utils/browser-polyfill', () => ({ default: {
  tabs: { onUpdated: { addListener: mock.listen }, get: mock.get, update: mock.update },
  scripting: { executeScript: mock.execute },
} }));
vi.mock('./client', () => ({ BridgeClient: class {
  cancelled = false;
  fetchJob = mock.fetchJob;
  status = mock.status;
} }));
vi.mock('./x', () => ({ runXJob: mock.x }));
vi.mock('./zhihu', () => ({ runZhihuJob: mock.zhihu }));
vi.mock('./xhs', () => ({ runXhsJob: mock.xhs }));
import { registerPublishBridge } from './index';

let nonce = 0;
const xhs = 'https://creator.xiaohongshu.com/publish/publish?source=clipper';
function handoff(cleanUrl: string, target: string) {
  const address = cleanUrl + '#qp=51234.' + String(++nonce).padStart(32, '0');
  const tagged = { id: 7, url: address, status: 'complete' };
  mock.get.mockResolvedValue(tagged);
  mock.fetchJob.mockResolvedValue({ target });
  const listener = mock.listen.mock.lastCall![0];
  listener(7, { url: address }, tagged);
  return { address, tagged, listener };
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.update.mockResolvedValue({});
  mock.status.mockResolvedValue(undefined);
  registerPublishBridge();
});

it.each([
  ['xhs', xhs, mock.xhs],
  ['x', 'https://x.com/compose/articles', mock.x],
  ['zhihu', 'https://zhuanlan.zhihu.com/write', mock.zhihu],
])('dispatches %s once and only after the clean navigation is ready', async (target, cleanUrl, runner) => {
  const { address, tagged, listener } = handoff(cleanUrl, target);
  listener(7, { status: 'complete' }, tagged);
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalledWith(7, { url: cleanUrl }));
  expect(runner).not.toHaveBeenCalled();
  mock.get.mockResolvedValue({ url: cleanUrl, status: 'loading' });
  const reads = mock.get.mock.calls.length;
  await vi.waitFor(() => expect(mock.get.mock.calls.length).toBeGreaterThan(reads));
  expect(runner).not.toHaveBeenCalled();
  mock.get.mockResolvedValue({ url: cleanUrl, status: 'complete' });
  await vi.waitFor(() => expect(runner).toHaveBeenCalledExactlyOnceWith(7, { target }, expect.anything()));
  expect(mock.fetchJob).toHaveBeenCalledTimes(1);
  expect(mock.get).toHaveBeenCalled();
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.update.mock.calls.some(([, options]) => options.url === address)).toBe(false);
});

it('reports navigation failure to the original job without dispatching', async () => {
  mock.update.mockRejectedValueOnce(new Error('tab closed'));
  handoff(xhs, 'xhs');
  await vi.waitFor(() => expect(mock.status).toHaveBeenCalledWith(expect.objectContaining({
    state: 'error', error: expect.objectContaining({ code: 'navigation-failed' }),
  })));
  expect(mock.xhs).not.toHaveBeenCalled();
});

it('does not take over a tab the user navigated away from while fetching the job', async () => {
  handoff(xhs, 'xhs');
  mock.get.mockResolvedValue({ url: 'https://example.com/', status: 'complete' });
  await vi.waitFor(() => expect(mock.status).toHaveBeenCalledWith(expect.objectContaining({ state: 'error' })));
  expect(mock.update).not.toHaveBeenCalled();
  expect(mock.xhs).not.toHaveBeenCalled();
});

it.each(['https://example.com/login', 'https://creator.xiaohongshu.com/login'])(
  'rejects a clean navigation that redirects to %s', async url => {
  mock.update.mockImplementationOnce(async () => {
    mock.get.mockResolvedValue({ url, status: 'complete' });
  });
  handoff(xhs, 'xhs');
  await vi.waitFor(() => expect(mock.status).toHaveBeenCalledWith(expect.objectContaining({ state: 'error' })));
  expect(mock.xhs).not.toHaveBeenCalled();
});

it('does not dispatch when the user stops while the clean page is loading', async () => {
  mock.status.mockImplementation(async function (this: { cancelled: boolean }, report) {
    if (report.state === 'running' && !report.text) this.cancelled = true;
  });
  mock.update.mockImplementationOnce(async () => {
    mock.get.mockResolvedValue({ url: xhs, status: 'complete' });
  });
  handoff(xhs, 'xhs');
  await vi.waitFor(() => expect(mock.status).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' })));
  expect(mock.xhs).not.toHaveBeenCalled();
});
