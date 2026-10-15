import { createElement, ChevronDown, Check } from 'lucide';

// A compact radio menu with native buttons; labels are supplied by the caller.
export function captionModeMenu<T extends string>(doc: Document, label: string, options: Array<{value:T;label:string}>, initial:T, onChange:(value:T)=>void) {
 const root=doc.createElement('span');root.className='q-caption-menu';
 const button=doc.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
 const text=doc.createElement('span');button.append(text,createElement(ChevronDown));
 const menu=doc.createElement('div');menu.className='q-caption-menu-items';menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);menu.hidden=true;
 let value=initial;
 let items:HTMLButtonElement[]=[];
 const build=()=>{items=options.map(option=>{
  const item=doc.createElement('button');item.type='button';item.setAttribute('role','menuitemradio');item.dataset.value=option.value;item.append(createElement(Check),doc.createTextNode(option.label));
  item.onclick=()=>{set(option.value);close();onChange(option.value);};menu.append(item);return item;
 });};build();
 const set=(next:T)=>{value=next;text.textContent=options.find(option=>option.value===next)?.label||'';items.forEach(item=>item.setAttribute('aria-checked',String(item.dataset.value===next)));};
 const close=(focus=true)=>{if(menu.hidden)return;menu.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();};
 const open=()=>{menu.hidden=false;button.setAttribute('aria-expanded','true');items[options.findIndex(option=>option.value===value)]?.focus();};
 button.onclick=()=>menu.hidden?open():close();
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'){close(false);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();if(menu.hidden){open();return;}
  const index=items.indexOf(doc.activeElement as HTMLButtonElement);
  items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();
 });
 const outside=(event:Event)=>{if(!root.contains(event.target as Node))close(false);};doc.addEventListener('pointerdown',outside);
 root.append(button,menu);set(initial);
 if(!doc.getElementById('q-caption-menu-style')){
  const style=doc.createElement('style');style.id='q-caption-menu-style';style.textContent=`
html .q-caption-menu{position:relative;display:inline-flex;font-size:12px;flex-shrink:0}
html .q-caption-menu button{appearance:none!important;display:inline-flex;align-items:center;gap:5px;width:auto!important;min-height:28px;padding:4px 8px!important;border:0!important;border-radius:5px;background:var(--background-secondary,#eee)!important;color:var(--text-normal,#222)!important;box-shadow:none!important;cursor:pointer;font:inherit}
html .q-caption-menu button:hover{background:var(--background-modifier-hover,#ddd)!important}
html .q-caption-menu button:focus-visible{outline:1px solid var(--text-muted,#777);outline-offset:2px}
html .q-caption-menu svg{width:14px;height:14px;mix-blend-mode:normal!important;flex-shrink:0}
html .q-caption-menu-items{position:absolute;right:0;top:calc(100% + 5px);z-index:720;min-width:160px;padding:4px;border:1px solid var(--background-modifier-border,#ccc);border-radius:6px;background:var(--background-primary,#fff);box-shadow:0 3px 12px #0002;display:flex;flex-direction:column;gap:2px}
html .q-caption-menu-items[hidden]{display:none!important}
html .q-caption-menu-items button{width:100%!important;justify-content:flex-start;background:transparent!important;text-align:left}
html .q-caption-menu-items button[aria-checked=false] svg{visibility:hidden}
`;doc.head.append(style);
 }
 return {element:root,button,set,close,setOptions:(next:Array<{value:T;label:string}>)=>{options=next;menu.replaceChildren();build();set(value);},destroy:()=>{doc.removeEventListener('pointerdown',outside);root.remove();}};
}
