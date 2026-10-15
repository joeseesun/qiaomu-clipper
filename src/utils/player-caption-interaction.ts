import { mountStudyTips } from './study-tips';
import { createElement, SlidersHorizontal, Move, Check, X } from 'lucide';
import { containedPictureRect } from './caption-geometry';
import { applyCaptionAppearance, captionAnchor, captionFontSize, captionPreset, ensureCaptionStyle, loadCaptionAppearance, normalizeCaptionPosition, saveCaptionAppearance, watchCaptionAppearance, type CaptionPosition } from './caption-appearance';
import { captionStyleEditor } from './caption-style-editor';
import { captionModeMenu } from './caption-mode-menu';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { t } from './ui-text';

const POSITION_KEY='qiaomuCaptionPositions';
const STYLE=`
html .q-caption-overlay{position:fixed;z-index:705;pointer-events:none;box-sizing:border-box;overflow:hidden;color:#fff;padding:0!important}
html .q-caption-overlay[hidden]{display:none!important}
html .q-caption-overlay[data-suppressed=true] .q-caption-stack{visibility:hidden}
html .q-caption-overlay .q-caption-stack{pointer-events:auto}html .q-caption-stack[data-editing=true]{cursor:grab;touch-action:none;pointer-events:auto;outline:1px dashed #fffc;outline-offset:5px;min-width:130px;min-height:34px}
html .q-caption-stack .q-caption-drag{display:none;position:absolute;left:50%;bottom:100%;transform:translateX(-50%);pointer-events:auto;touch-action:none;cursor:grab;appearance:none!important;width:auto!important;min-width:0!important;min-height:26px;margin:0!important;padding:4px 7px!important;border:0!important;border-radius:5px;box-shadow:none!important;font:500 12px/1.4 system-ui,sans-serif;align-items:center;gap:5px;background:#242424!important;color:#fff!important;z-index:1}
html .q-caption-stack:is(:hover,:focus-within) .q-caption-drag{display:inline-flex}
html .q-caption-stack[data-editing=true] .q-caption-drag{display:none}
html .q-caption-edit-actions{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);gap:6px;white-space:nowrap}
html .q-caption-stack[data-editing=true] .q-caption-edit-actions{display:flex}
html .q-caption-edit-actions button{display:inline-flex;align-items:center;gap:4px;width:auto!important;min-height:30px;padding:5px 8px!important;margin:0;border:0;border-radius:5px;background:#242424!important;color:#fff!important;box-shadow:none!important;font:500 12px/1.4 system-ui,sans-serif;cursor:pointer}
html .q-caption-edit-actions button:hover{background:#444!important}
html .q-caption-edit-actions svg{width:14px;height:14px;mix-blend-mode:normal!important}
html .q-caption-stack:focus-visible{outline:1px solid #ddd;outline-offset:3px}
html .q-caption-edit-actions button:focus-visible{outline:1px solid #ddd;outline-offset:2px}

html .q-caption-drag:active{cursor:grabbing}
html .q-player-caption-panel{position:fixed;z-index:730;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--background-modifier-border,#ccc);border-radius:8px;background:var(--background-primary,#fff);color:var(--text-normal,#222);box-shadow:0 4px 20px #0003;font:400 13px/1.5 system-ui,sans-serif}
html .q-player-caption-panel[hidden]{display:none!important}
html .q-player-caption-panel header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:600}
html .q-player-caption-panel button{appearance:none;width:auto!important;min-height:28px;padding:5px 8px!important;border:0!important;border-radius:5px;background:var(--background-secondary,#eee)!important;color:var(--text-normal,#222)!important;box-shadow:none!important;font:inherit;cursor:pointer}
html .q-player-caption-panel button:hover{background:var(--background-modifier-hover,#ddd)!important}
html .q-player-caption-panel :is(button,select,input):focus-visible{outline:1px solid var(--text-muted,#777);outline-offset:2px}
html .q-player-caption-panel svg,html .q-caption-drag svg{width:16px;height:16px;mix-blend-mode:normal!important}
html .q-player-hud{position:fixed;z-index:725;top:14px;right:14px;max-width:calc(100vw - 28px);padding:6px 8px;border-radius:6px;background:#202020;--background-secondary:#333;--background-primary:#202020;--background-modifier-hover:#444;--text-normal:#fff;--text-muted:#bbb}
html .q-player-hud[hidden]{display:none!important}
html .q-player-hud .q-caption-menu-items{top:calc(100% + 8px)}
html .player-container:fullscreen{display:block!important;width:100vw!important;max-width:none!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;background:#000!important;position:fixed!important;inset:0!important}
html .player-container:fullscreen>.youtube-sized-player,html .player-container:fullscreen>.reader-video-wrapper,html .player-container:fullscreen>iframe{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-height:none!important;max-width:none!important;margin:0!important;border-radius:0!important;aspect-ratio:auto!important;transform:none!important}
html .player-container:fullscreen video{height:100%!important;width:100%!important;object-fit:contain}
html .player-container:fullscreen>.youtube-mode-bar,html .player-container:fullscreen>.youtube-player-resize,html .player-container:fullscreen>.youtube-float-chrome,html .player-container:fullscreen>.player-toggles{display:none!important}
`.split('html .player-container:fullscreen').join(':is(html .player-container:fullscreen, html.youtube-study.obsidian-reader-active:has(.youtube-sized-player) body .obsidian-reader-content article[data-yt-layout] .player-container:fullscreen)');
interface EmbeddedState { controlsVisible?:boolean;menuOpen?:boolean;availableRates?:number[];rate?:number;activity?:number;picture?:unknown }
export function mountCaptionInteraction(container:HTMLElement,player:HTMLVideoElement|HTMLIFrameElement,row:HTMLElement,overlay:HTMLElement,stack:HTMLElement,source:HTMLElement,target:HTMLElement,status:HTMLElement,enable:()=>void=()=>{}){
 const doc=container.ownerDocument,win=doc.defaultView!,video=player.tagName==='VIDEO'?player as HTMLVideoElement:undefined,frame=video?undefined:player as HTMLIFrameElement;
 ensureCaptionStyle(doc);if(!doc.getElementById('q-caption-interaction-style')){const s=doc.createElement('style');s.id='q-caption-interaction-style';s.textContent=STYLE;doc.head.append(s);}
 const node=(tag:'button'|'div',className='',text='')=>{const el=doc.createElement(tag);el.className=className;el.textContent=text;return el;};
 const button=(label:string,icon?:Parameters<typeof createElement>[0])=>{const el=node('button') as HTMLButtonElement;el.type='button';el.setAttribute('aria-label',label);el.title=label;if(icon)el.append(createElement(icon));else el.textContent=label;return el;};
 let disposed=false,editing=false,nativeMenu=false,nativeControls=false,appearance=captionPreset(),revision=0,positions:Record<string,CaptionPosition>={},positionsRevision=0,lastRect=player.getBoundingClientRect(),hudTimer:ReturnType<typeof setTimeout>|undefined;
 let hoverControls:boolean|undefined;
 let lastActivity=0; let editSnapshot:Record<string,CaptionPosition>|undefined; let editContext='';
 let embeddedPicture:{x:number;y:number;width:number;height:number;viewportWidth:number;viewportHeight:number}|undefined;
 let extendedRates=false;
 let rates=video?[.5,.75,1,1.25,1.5,1.75,2,3]:[1],actualRate=video?.playbackRate||1;
 const context=()=>doc.fullscreenElement===container?'fullscreen':container.closest('article')?.getAttribute('data-yt-layout')==='float'?'mini':container.closest('article')?.getAttribute('data-yt-layout')==='theater'?'theater':'dock';
 const position=()=>normalizeCaptionPosition(positions[context()]||positions.normal);
 const persistPosition=(next:CaptionPosition)=>{positionsRevision++;positions={...positions,[context()]:normalizeCaptionPosition(next)};void setLocalStorage(POSITION_KEY,positions).catch(()=>status.textContent=t('字幕位置保存失败'));};
 const styleButton=button(t('字幕样式'),SlidersHorizontal);
 styleButton.setAttribute('aria-haspopup','dialog');styleButton.setAttribute('aria-expanded','false');
 row.append(styleButton);
 const panel=node('div','q-player-caption-panel');panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',t('字幕样式'));
 const header=doc.createElement('header'),title=doc.createElement('span'),close=button(t('关闭'));title.textContent=t('字幕样式');header.append(title,close);panel.append(header);
 const editor=captionStyleEditor(doc,appearance,next=>{revision++;appearance=next;layout(lastRect);void saveCaptionAppearance(next).catch(()=>status.textContent=t('字幕样式保存失败'));});panel.append(editor.element);
 container.append(panel);
 const drag=button(t('拖动字幕位置'),Move);drag.className='q-caption-drag';drag.append(doc.createTextNode(t('拖动字幕位置')));stack.append(drag);
 const finish=button(t('完成'),Check),cancel=button(t('取消'),X),editActions=node('div','q-caption-edit-actions');
 finish.append(doc.createTextNode(t('完成')));cancel.append(doc.createTextNode(t('取消')));editActions.append(finish,cancel);stack.append(editActions);
 stack.tabIndex=0;stack.setAttribute('aria-label',t('调整字幕位置'));stack.setAttribute('aria-keyshortcuts','Enter');

 const setEditing=(next:boolean)=>{if(next&&!editing){editSnapshot=structuredClone(positions);editContext=context();positionsRevision++;}else if(!next&&editing&&editSnapshot){positions=editSnapshot;editSnapshot=undefined;}editing=next;stack.dataset.editing=String(next);layout(lastRect);showHud();};
 const endDrag=()=>{if(stack.hasPointerCapture?.(activePointer??-1))stack.releasePointerCapture(activePointer!);activePointer=undefined;dragStart=undefined;};
 const closePanel=(focus=true)=>{if(panel.hidden)return;panel.hidden=true;styleButton.setAttribute('aria-expanded','false');if(focus)styleButton.focus();showHud();};
 const placePanel=()=>{const r=styleButton.getBoundingClientRect();panel.style.left=`${Math.max(12,Math.min(win.innerWidth-panel.offsetWidth-12,r.right-panel.offsetWidth))}px`;panel.style.top=`${Math.max(12,Math.min(win.innerHeight-panel.offsetHeight-12,r.bottom+8))}px`;};
 styleButton.onclick=()=>{if(!panel.hidden){closePanel();return;}panel.hidden=false;styleButton.setAttribute('aria-expanded','true');editor.set(appearance);placePanel();close.focus();showHud();};close.onclick=()=>closePanel();
 const beginEdit=()=>{enable();const current={x:parseFloat(stack.style.left)/lastRect.width,y:parseFloat(stack.style.top)/lastRect.height};setEditing(true);if(Number.isFinite(current.x)&&Number.isFinite(current.y)){positions={...positions,[context()]:normalizeCaptionPosition(current)};layout(lastRect);}closePanel(false);stack.focus();};
 drag.onclick=()=>{if(!editing)beginEdit();};
 finish.onclick=()=>{const next=position();editSnapshot=undefined;persistPosition(next);setEditing(false);stack.focus();};
 cancel.onclick=()=>{endDrag();setEditing(false);stack.focus();};

 const anchor=doc.createComment('caption-controls');row.before(anchor);const hud=node('div','q-player-hud');hud.hidden=true;container.append(hud);
 const fullscreen=()=>doc.fullscreenElement===container;
 const hideHud=()=>{if(disposed)return;if(editing||!panel.hidden||(hud.contains(doc.activeElement)&&doc.activeElement?.matches(':focus-visible'))||hud.querySelector('[aria-expanded=true]')){hudTimer=setTimeout(hideHud,3000);return;}hud.hidden=true;};
 const showHud=()=>{clearTimeout(hudTimer);if(!fullscreen())return;hud.hidden=false;hudTimer=setTimeout(hideHud,3000);};
 const syncFullscreen=()=>{endDrag();closePanel(false);setEditing(false);if(fullscreen()){hud.append(row);showHud();}else{anchor.after(row);hud.hidden=true;clearTimeout(hudTimer);}layout(player.getBoundingClientRect());};
 const speed=captionModeMenu(doc,t('播放速度'),rates.map(rate=>({value:String(rate),label:`${rate}×`})),String(actualRate),next=>{
  speed.set(String(actualRate));const rate=Number(next);if(!rates.includes(rate))return;
  if(video){try{video.playbackRate=rate;updateRate(video.playbackRate);}catch{status.textContent=t('当前播放器不支持此倍速');}}
  else if(frame?.src.includes('youtube.com/embed/')&&rate<=2)frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[rate]}),new URL(frame.src).origin);
  else frame?.contentWindow?.postMessage({qiaomuPlayer:'rate',rate},new URL(frame!.src).origin);
 });row.append(speed.element);
 const updateRate=(rate:number)=>{if(!Number.isFinite(rate)||rate<=0||rate>16)return;actualRate=rate;speed.set(String(rate));speed.button.querySelector('span')!.textContent=`${rate}×`;};
 const updateRates=(incoming:unknown)=>{if(!Array.isArray(incoming))return;if(incoming.includes(3))extendedRates=true;const available=extendedRates?[...incoming,3]:incoming;const next=[...new Set(available.filter(n=>typeof n==='number'&&Number.isFinite(n)&&[.25,.5,.75,1,1.25,1.5,1.75,2,3].includes(n)))].sort((a,b)=>a-b);if(!next.length||JSON.stringify(next)===JSON.stringify(rates))return;rates=next;speed.setOptions(rates.map(rate=>({value:String(rate),label:`${rate}×`})));updateRate(actualRate);};
 let lastLayout='';
 function layout(rect:DOMRect){
  if(disposed)return;if(editing&&context()!==editContext){positions=editSnapshot||positions;editSnapshot=undefined;editing=false;stack.dataset.editing='false';}lastRect=rect;const key=JSON.stringify([rect.width,rect.height,source.textContent,target.textContent,source.hidden,target.hidden,appearance,position(),editing,hoverControls,nativeControls,nativeMenu]);if(key===lastLayout)return;lastLayout=key;applyCaptionAppearance(stack,source,target,appearance,captionFontSize(rect.width,rect.height));
  const bound=stack.getBoundingClientRect(),at=captionAnchor(position(),rect.width,rect.height,bound.width,bound.height+(editing?44:0),(hoverControls??nativeControls)&&!editing);
  stack.style.left=`${at.x}px`;stack.style.top=`${at.y}px`;overlay.dataset.suppressed=String(nativeMenu&&!editing&&hoverControls===undefined);
  if(editing&&!source.textContent&&!target.textContent){target.textContent=t('拖动字幕位置');target.hidden=false;}
 }
 let activePointer:number|undefined,dragStart:{x:number;y:number;position:CaptionPosition}|undefined;
 stack.onpointerdown=event=>{if(event.button!==0||(event.target as Element).closest('.q-caption-edit-actions'))return;if(!editing){if(!(event.target as Element).closest('.q-caption-drag'))return;beginEdit();}event.preventDefault();event.stopPropagation();activePointer=event.pointerId;dragStart={x:event.clientX,y:event.clientY,position:{x:parseFloat(stack.style.left)/lastRect.width,y:parseFloat(stack.style.top)/lastRect.height}};stack.setPointerCapture?.(event.pointerId);};
 stack.onpointermove=event=>{if(event.pointerId!==activePointer||!dragStart||!lastRect.width||!lastRect.height)return;positions={...positions,[context()]:normalizeCaptionPosition({x:Math.abs(dragStart.position.x+(event.clientX-dragStart.x)/lastRect.width-.5)<.015?.5:dragStart.position.x+(event.clientX-dragStart.x)/lastRect.width,y:dragStart.position.y+(event.clientY-dragStart.y)/lastRect.height})};layout(lastRect);};
 stack.onpointerup=event=>{if(event.pointerId!==activePointer)return;endDrag();};stack.onpointercancel=()=>{if(dragStart)positions={...positions,[context()]:dragStart.position};endDrag();layout(lastRect);};stack.onlostpointercapture=()=>{activePointer=undefined;dragStart=undefined;};
 stack.onkeydown=event=>{if((event.target as Element).closest('.q-caption-edit-actions'))return;if(!editing){if(event.key==='Enter'){event.preventDefault();beginEdit();}return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape'].includes(event.key))return;event.preventDefault();event.stopPropagation();if(event.key==='Enter'||event.key==='Escape'){if(event.key==='Enter')finish.click();else cancel.click();return;}const p=position(),step=event.shiftKey?.05:.01;positions={...positions,[context()]:normalizeCaptionPosition({x:p.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),y:p.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)})};layout(lastRect);};
 // Return mouse-operated toolbar controls to the player; Tab users keep button semantics.
 const removeTips=mountStudyTips(container);
 const previousTabindex=container.getAttribute('tabindex');container.tabIndex=0;container.setAttribute('aria-keyshortcuts','Space k j l');
 const toolbarClick=(event:MouseEvent)=>{if(event.detail>0&&row.contains(event.target as Node)&&panel.hidden&&!row.querySelector('[aria-expanded=true]'))container.focus({preventScroll:true});};
 const playbackKey=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||editing||!panel.hidden)return;
  if(![' ','k','j','l'].includes(event.key.toLowerCase()))return;
  const target=event.target as HTMLElement;
  if(!container.contains(target)||target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable=false]),[role=menu],[role=dialog]'))return;
  event.preventDefault();event.stopPropagation();if(event.repeat)return;
  const delta=event.key.toLowerCase()==='j'?-10:event.key.toLowerCase()==='l'?10:0;
  if(delta){if(video)video.currentTime=Math.max(0,Math.min(Number.isFinite(video.duration)?video.duration:Infinity,video.currentTime+delta));else if(frame)frame.contentWindow?.postMessage({qiaomuPlayer:'skip',delta},new URL(frame.src).origin);}
  else if(video){if(video.paused)void video.play().catch(()=>{});else video.pause();}
  else if(frame)frame.contentWindow?.postMessage({qiaomuPlayer:'toggle'},new URL(frame.src).origin);
  showHud();
 };
 container.addEventListener('click',toolbarClick);container.addEventListener('keydown',playbackKey);
 const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(!panel.hidden){event.preventDefault();event.stopPropagation();closePanel();}else if(editing){event.preventDefault();setEditing(false);}}else if(event.key==='Tab')showHud();};
 const outside=(event:PointerEvent)=>{if(!panel.contains(event.target as Node)&&!styleButton.contains(event.target as Node))closePanel(false);};
 const nativeMove=()=>{if(doc.activeElement!==frame)nativeMenu=false;if(video)nativeControls=true;layout(lastRect);showHud();};let nativeTimer:ReturnType<typeof setTimeout>|undefined;
 const activity=()=>{if(hoverControls!==undefined||editing){showHud();return;}nativeMove();clearTimeout(nativeTimer);nativeTimer=setTimeout(()=>{nativeControls=false;layout(lastRect);},3000);};
 const blur=()=>{if(activePointer!==undefined&&dragStart){positions={...positions,[context()]:dragStart.position};}endDrag();if(frame&&doc.activeElement===frame){nativeMenu=true;layout(lastRect);}};
 const nativeRate=()=>video&&updateRate(video.playbackRate);
 const enterCaptions=()=>{hoverControls??=nativeControls;};const leaveCaptions=()=>{hoverControls=undefined;layout(lastRect);};
 stack.addEventListener('pointerenter',enterCaptions);stack.addEventListener('pointerleave',leaveCaptions);
 container.addEventListener('pointermove',activity);container.addEventListener('focusin',showHud);doc.addEventListener('fullscreenchange',syncFullscreen);doc.addEventListener('keydown',keyboard);doc.addEventListener('pointerdown',outside);win.addEventListener('blur',blur);video?.addEventListener('ratechange',nativeRate);
 const stopWatch=watchCaptionAppearance(next=>{revision++;appearance=next;editor.set(next);layout(lastRect);});
 const startingRevision=revision;void loadCaptionAppearance().then(next=>{if(disposed||revision!==startingRevision)return;appearance=next;editor.set(next);layout(lastRect);}).catch(()=>{});
 const initialPositionsRevision=positionsRevision;void getLocalStorage(POSITION_KEY).then(saved=>{if(disposed||positionsRevision!==initialPositionsRevision||!saved||typeof saved!=='object')return;positions=Object.fromEntries(['normal','dock','theater','mini','fullscreen'].filter(key=>saved[key]).map(key=>[key,normalizeCaptionPosition(saved[key])]));layout(lastRect);}).catch(()=>{});
 const measure=()=>{
  const r=player.getBoundingClientRect();if(video&&getComputedStyle(video).objectFit==='contain')return containedPictureRect(r,video.videoWidth,video.videoHeight);
  const p=embeddedPicture;if(!p)return r;const x=Math.max(0,p.x)/p.viewportWidth,y=Math.max(0,p.y)/p.viewportHeight,right=Math.min(1,(p.x+p.width)/p.viewportWidth),bottom=Math.min(1,(p.y+p.height)/p.viewportHeight);
  return new DOMRect(r.left+r.width*x,r.top+r.height*y,r.width*Math.max(0,right-x),r.height*Math.max(0,bottom-y));
 };
 return {layout,measure,update:(data:EmbeddedState)=>{if(disposed)return;const p=data.picture as any;if(p&&['x','y','width','height','viewportWidth','viewportHeight'].every(key=>typeof p[key]==='number'&&Number.isFinite(p[key]))&&p.width>0&&p.height>0&&p.viewportWidth>0&&p.viewportHeight>0&&p.x<p.viewportWidth&&p.y<p.viewportHeight&&p.x+p.width>0&&p.y+p.height>0)embeddedPicture=p;const reveal=data.controlsVisible&&!nativeControls;if(typeof data.controlsVisible==='boolean')nativeControls=data.controlsVisible;if(typeof data.menuOpen==='boolean')nativeMenu=data.menuOpen;if(typeof data.rate==='number')updateRate(data.rate);updateRates(data.availableRates);layout(lastRect);if(reveal||typeof data.activity==='number'&&Number.isFinite(data.activity)&&data.activity>lastActivity){lastActivity=data.activity||lastActivity;showHud();}},destroy:()=>{
  if(disposed)return;disposed=true;removeTips();container.removeEventListener('click',toolbarClick);container.removeEventListener('keydown',playbackKey);if(previousTabindex===null)container.removeAttribute('tabindex');else container.setAttribute('tabindex',previousTabindex);container.removeAttribute('aria-keyshortcuts');clearTimeout(hudTimer);clearTimeout(nativeTimer);endDrag();stopWatch();speed.destroy();doc.removeEventListener('fullscreenchange',syncFullscreen);doc.removeEventListener('keydown',keyboard);doc.removeEventListener('pointerdown',outside);win.removeEventListener?.('blur',blur);stack.removeEventListener('pointerenter',enterCaptions);stack.removeEventListener('pointerleave',leaveCaptions);container.removeEventListener('pointermove',activity);container.removeEventListener('focusin',showHud);video?.removeEventListener('ratechange',nativeRate);if(hud.contains(row))anchor.after(row);anchor.remove();hud.remove();panel.remove();drag.remove();editActions.remove();stack.removeAttribute('tabindex');stack.removeAttribute('aria-label');stack.removeAttribute('aria-keyshortcuts');stack.onpointerdown=stack.onpointermove=stack.onpointerup=stack.onpointercancel=stack.onlostpointercapture=null;stack.onkeydown=null;
 }};
}
