// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';
it('uses a full-width native panel with solid background and usable controls',()=>{
 const css=compile(resolve('src/styles/ai-side-panel.scss'),{logger:{warn(){},debug(){}}}).css;
 // jsdom cannot resolve CSS custom properties in color declarations. Resolve only
 // the existing theme colors; selectors, layout, cascade and control rules stay real.
 const lightCss=css.split('var(--background-secondary)').join('#f6f6f6').split('var(--background-primary)').join('#ffffff').split('var(--text-normal)').join('#222222').split('var(--text-muted)').join('#666666');
 document.head.innerHTML='<style>'+lightCss+'</style>';
 document.body.className='ai-sidebar-chat';
 document.body.innerHTML='<aside class="clip-chat"><div class="clip-chat-resize"></div><div class="clip-chat-header"><button class="clip-chat-model">Model</button></div><form class="clip-chat-composer"><div class="clip-chat-context">Article</div><textarea></textarea><div class="clip-chat-composer-tools"><button class="qm-search-toggle" aria-pressed="true">Search</button></div></form></aside>';
 expect(getComputedStyle(document.querySelector('.clip-chat')!).width).toBe('100%');
 expect(getComputedStyle(document.querySelector('.clip-chat-resize')!).display).toBe('none');
 expect(getComputedStyle(document.querySelector('.clip-chat-composer')!).backgroundColor).toBe('rgb(255, 255, 255)');
 expect(getComputedStyle(document.querySelector('.qm-search-toggle')!).width).toBe('28px');
 expect(getComputedStyle(document.querySelector('.clip-chat-header')!).flexShrink).toBe('0');
 expect(getComputedStyle(document.querySelector('.clip-chat-model')!).color).not.toBe('transparent');
});
