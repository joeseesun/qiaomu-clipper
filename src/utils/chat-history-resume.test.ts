import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: {} as Record<string, any>, create: vi.fn(), update: vi.fn(), order: [] as string[] }));
vi.mock('./browser-polyfill', () => ({ default: {
 tabs: { create: (...args: any[]) => state.create(...args), update: (...args: any[]) => state.update(...args) },
 storage: { session: { get: async (key: string) => ({ [key]: state.values[key] }), set: async (items: any) => { state.order.push('save'); Object.assign(state.values, items); }, remove: async (key: string) => { delete state.values[key]; } } },
} }));
vi.mock('./ai-sidebar', () => ({ openCurrentAiSidebar: async () => {} }));
import { openChatSource, consumeChatResume } from './chat-history-resume';
beforeEach(() => { vi.clearAllMocks(); state.values = {}; state.order = []; state.create.mockResolvedValue({ id: 42 }); state.update.mockImplementation(async () => { state.order.push('activate'); }); });
it('hands off the exact chat before activating the new tab, without changing the URL', async () => {
 await openChatSource({ url: 'https://page.test/#/route', title: 'Page', preserveUrlHash: true }, 'older-chat');
 expect(state.create).toHaveBeenCalledWith({ url: 'https://page.test/#/route', active: false }); expect(state.order).toEqual(['save', 'activate']);
 expect(await consumeChatResume(43, 'https://page.test/#/route')).toBeUndefined();
 expect(await consumeChatResume(42, 'https://page.test/#/route')).toEqual({ id: 'older-chat', pageKey: 'https://page.test/#/route' });
 expect(await consumeChatResume(42, 'https://page.test/#/route')).toBeUndefined();
});
it('rejects a different source, expired handoffs and executable URLs', async () => {
 await expect(openChatSource({ url: 'javascript:alert(1)', title: 'No' }, 'id')).rejects.toThrow(); expect(state.create).not.toHaveBeenCalled();
 await openChatSource({ url: 'https://page.test/#a', title: 'Page', preserveUrlHash: true }, 'id');
 expect(await consumeChatResume(42, 'https://page.test/#b')).toBeUndefined();
 await openChatSource({ url: 'https://page.test/', title: 'Page' }, 'id'); state.values['qiaomu-chat-resume:42'].createdAt -= 700000;
 expect(await consumeChatResume(42, 'https://page.test/')).toBeUndefined();
});
it('still activates the source page if saving the handoff fails', async () => {
 const browser = (await import('./browser-polyfill')).default;
 const set = vi.spyOn(browser.storage.session, 'set').mockRejectedValueOnce(new Error('Session unavailable'));
 try {
  await expect(openChatSource({ url: 'https://page.test/', title: 'Page' }, 'id')).rejects.toThrow('Session unavailable');
  expect(state.update).toHaveBeenCalledWith(42, { active: true });
 } finally { set.mockRestore(); }
});
