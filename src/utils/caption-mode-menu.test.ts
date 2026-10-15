// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {captionModeMenu} from './caption-mode-menu';
it('supports keyboard selection, closes on Escape or outside clicks and preserves radio state',()=>{
 document.body.innerHTML='';const changed=vi.fn();const menu=captionModeMenu(document,'字幕显示方式',[{value:'original',label:'原文'},{value:'bilingual',label:'双语'}],'bilingual',changed);document.body.append(menu.element);
 menu.button.click();expect(menu.button.getAttribute('aria-expanded')).toBe('true');expect(document.activeElement?.getAttribute('data-value')).toBe('bilingual');
 document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));expect(document.activeElement?.getAttribute('data-value')).toBe('original');(document.activeElement as HTMLButtonElement).click();expect(changed).toHaveBeenCalledWith('original');expect(menu.button.getAttribute('aria-expanded')).toBe('false');
 menu.button.click();document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(menu.button);
 menu.button.click();document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));expect(menu.button.getAttribute('aria-expanded')).toBe('false');menu.destroy();expect(document.querySelector('.q-caption-menu')).toBeNull();
});
