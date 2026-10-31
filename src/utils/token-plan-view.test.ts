// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { mountChatTools } from './chat-tool-view';
import { nativeToolResult } from './token-plan-stream';
import { setUiLanguage } from './ui-text';

it('renders actual code and output as inert text, shows image sources, and retries through a new conversation request', () => {
 setUiLanguage('zh_CN'); const parent = document.createElement('div'), followup = vi.fn();
 const code = nativeToolResult({ id: 'c', type: 'code_interpreter_call', status: 'completed', code: '<script>bad()</script>', outputs: [{ type: 'logs', logs: '42' }] })!;
 const image = nativeToolResult({ id: 'i', type: 'web_search_image_call', status: 'completed', output: '[{"title":"picture","url":"https://example.com/picture.png"}]' })!;
 mountChatTools(parent, [code, image, { ...code, id: 'failed', state: 'error', error: 'interrupted' }], { persist: async () => {}, followup });
 expect(parent.querySelector('script')).toBeNull(); expect(parent.textContent).toContain('<script>bad()</script>');
 expect(parent.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
 expect(parent.textContent).toContain('Token Plan'); expect(parent.textContent).not.toContain('连接服务');
 parent.querySelector<HTMLButtonElement>('button')!.click(); expect(followup).toHaveBeenCalledOnce();
});

it('does not retry provider tools from read-only history', () => {
 const parent = document.createElement('div'), followup = vi.fn();
 const result = nativeToolResult({ id: 'failed', type: 'code_interpreter_call', status: 'failed', error: 'interrupted' })!;
 mountChatTools(parent, [result], { readOnly: true, persist: async () => {}, followup });
 expect(parent.querySelector('button')).toBeNull();
 expect(parent.textContent).toContain('Token Plan'); expect(followup).not.toHaveBeenCalled();
});
