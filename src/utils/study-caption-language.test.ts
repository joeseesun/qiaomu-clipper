// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { mountStudyCaptionLanguage } from './study-caption-language';
it('retains the player while moving the language selector to a replacement toolbar, and restores selection on failure', async () => {
 document.body.innerHTML = '<article><video></video><div class="player-toggle-group"></div><div class="transcript">English</div></article>';
 const article = document.querySelector('article')!, video = article.querySelector('video')!; video.currentTime = 47;
 const load = vi.fn(async () => { article.querySelector('.player-toggle-group')!.remove(); const row = document.createElement('div'); row.className='player-toggle-group'; article.append(row); });
 mountStudyCaptionLanguage(article, [{id:'en',label:'English'},{id:'zh-cn',label:'中文'}], 'en', load);
 const select = article.querySelector('select')!; select.value='zh-cn'; select.dispatchEvent(new Event('change')); await Promise.resolve(); await Promise.resolve();
 expect(load).toHaveBeenCalledWith('zh-cn'); expect(article.querySelector('video')).toBe(video); expect(video.currentTime).toBe(47); expect(article.querySelector('.player-toggle-group select')).toBe(select);
 load.mockRejectedValueOnce(new Error('offline')); select.value='en'; select.dispatchEvent(new Event('change')); await Promise.resolve(); await Promise.resolve();
 expect(select.value).toBe('zh-cn'); expect(select.disabled).toBe(false); expect(article.textContent).toContain('切换失败');
});
