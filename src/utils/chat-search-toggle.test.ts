// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ caps: vi.fn(), tool: vi.fn() }));
vi.mock('./chat-tools-client', () => ({ chatCapabilities: mock.caps, requestChatTool: mock.tool, downloadChatPhoto: vi.fn() }));
import { createSearchToggle } from './chat-tool-view';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); mock.caps.mockResolvedValue({webEnabled: true}); mock.tool.mockResolvedValue({}); });
it('uses an accessible icon toggle and changes state only after a successful save', async () => {
 const button = createSearchToggle(); document.body.append(button); await flush();
 expect(button.querySelector('svg')).not.toBeNull(); expect(button.getAttribute('aria-pressed')).toBe('true');
 button.click(); expect(button.disabled).toBe(true); await flush();
 expect(mock.tool).toHaveBeenCalledWith({type:'set_search_enabled',enabled:false}); expect(button.getAttribute('aria-pressed')).toBe('false');
 const name = button.getAttribute('aria-label'); mock.tool.mockRejectedValueOnce(new Error('network'));
 button.click(); await flush(); expect(button.getAttribute('aria-pressed')).toBe('false'); expect(button.getAttribute('aria-label')).toBe(name); expect(button.disabled).toBe(false);
});
it('does not overwrite a completed toggle with a late initial settings response', async () => {
 let resolve!: (c: {webEnabled:boolean}) => void; mock.caps.mockReturnValue(new Promise(r => {resolve=r;}));
 const button = createSearchToggle(); button.click(); await flush(); resolve({webEnabled:true}); await flush();
 expect(button.getAttribute('aria-pressed')).toBe('false');
});
