import { afterEach, expect, it } from 'vitest';
import { setUiLanguage } from '../utils/ui-text';
import { describeXMediaMessage } from './media-messages';
afterEach(()=>setUiLanguage('zh_CN'));
it('shows processing rather than repeated uploading and removes unsupported throttling advice',()=>{
 setUiLanguage('zh_CN');
 expect(describeXMediaMessage('Uploading media 22/25... X is processing (60%)')).toBe('X 正在处理媒体 22/25…(60%)');
 const error=describeXMediaMessage('Media 22/25: X did not confirm media completion. The media may already be in the draft; check it before writing again.');
 expect(error).toContain('媒体 22/25：');expect(error).toContain('避免重复写入');expect(error).not.toMatch(/throttl|拆分/);
 setUiLanguage('en');expect(describeXMediaMessage('Uploading media 22/25... X is processing')).toBe('X is processing media 22/25…');
});
