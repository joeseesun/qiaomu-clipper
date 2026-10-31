// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ sendMessage: vi.fn(), executeScript: vi.fn(), get: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { tabs: { sendMessage: api.sendMessage }, scripting: { executeScript: api.executeScript }, storage: { local: { get: api.get } } } }));
import { webStudyPath } from './web-study-path';
const article = 'https://x.com/star_flow_ai/status/2097583620936585339';
beforeEach(() => {
  vi.clearAllMocks(); api.get.mockResolvedValue({});
  api.sendMessage.mockResolvedValue({ url: null });
  api.executeScript.mockResolvedValue([{ result: true }]);
});
it('keeps an X article in reading mode when its adapter rejects the embedded GIF', async () => {
  expect(await webStudyPath(article, 7)).toBeNull();
  expect(api.executeScript).not.toHaveBeenCalled();
});
it('does not substitute an unrelated reply video when the X content script is unavailable', async () => {
  api.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
  expect(await webStudyPath(article, 7)).toBeNull();
});
it('keeps real X post videos in media study mode', async () => {
  api.sendMessage.mockResolvedValue({ url: article });
  expect(await webStudyPath(article, 7)).toBe(`reader.html?study=web&url=${encodeURIComponent(article)}&sourceTab=7`);
});
it('rejects a stale X source reply for another post', async () => {
  api.sendMessage.mockResolvedValue({ url: 'https://x.com/maker/status/123456789' });
  expect(await webStudyPath(article, 7)).toBeNull();
});
it('preserves explicit media study from a feed and media-only site routes', async () => {
  api.sendMessage.mockResolvedValue({ url: article });
  expect(await webStudyPath('https://x.com/home', 7)).toContain(encodeURIComponent(article));
  api.sendMessage.mockResolvedValue(undefined); api.executeScript.mockResolvedValue([{ result: false }]);
  expect(await webStudyPath('https://vimeo.com/12345', 7)).toContain('study=web');
});
