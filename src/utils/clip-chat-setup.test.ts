// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [], streamChat: vi.fn() }));
import browser from './browser-polyfill';
import { mountClipChat } from './clip-chat';

it('opens AI model configuration from the rendered no-model state without enabling chat', async () => {
 document.body.innerHTML = '';
 const create = vi.fn().mockResolvedValue({});
 Object.assign(browser.tabs, { create });
 vi.spyOn(browser.runtime, 'getURL').mockImplementation(path => `chrome-extension://test/${path}`);
 const chat = mountClipChat({ getContext: () => ({ title: 'Article', url: 'https://example.com/', markdown: 'Article text' }), onInsert: vi.fn() });
 chat.toggle();
 for (let i = 0; i < 40; i++) await Promise.resolve();
 const setup = document.querySelector<HTMLButtonElement>('.clip-chat-model-setup')!;
 expect(setup.textContent).toBe('Set up AI models');
 expect(setup.parentElement!.textContent).not.toContain('“AI 解读”');
 expect(document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')?.disabled).toBe(true);
 setup.click();
 expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/settings.html?section=interpreter' });
 vi.restoreAllMocks();
});
