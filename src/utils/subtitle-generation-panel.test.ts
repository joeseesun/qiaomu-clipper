// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildGenerationPanel } from './subtitle-generation-panel';
import { generationStrings } from './subtitle-generation-strings';

it.each(['helper-offline', 'helper-outdated', 'cloud-not-configured', 'missing'] as const)('offers an actionable setup button for %s without restarting a job', reason => {
 const setup = vi.fn(), request = vi.fn();
 const panel = buildGenerationPanel(document, generationStrings((_, zh) => zh), { request, setup, confirm: vi.fn(), cancel: vi.fn() });
 panel.show({ kind: 'setup', reason, hints: [] });
 const buttons = panel.element.querySelectorAll('button');
 expect(buttons[0].textContent).toBe(reason.startsWith('helper-') ? '安装或更新本地助手' : '配置语音识别');
 buttons[0].click();
 expect(setup).toHaveBeenCalledWith(reason); expect(request).not.toHaveBeenCalled();
 expect(buttons[1].textContent).toBe('重新检查');
});
it('does not suggest installation or configuration while another task is busy', () => {
 const setup = vi.fn();
 const panel = buildGenerationPanel(document, generationStrings((_, zh) => zh), { request: vi.fn(), setup, confirm: vi.fn(), cancel: vi.fn() });
 panel.show({ kind: 'setup', reason: 'busy', hints: [] });
 expect(Array.from(panel.element.querySelectorAll('button')).map(b => b.textContent)).toEqual(['重新检查']);
 expect(setup).not.toHaveBeenCalled();
});
