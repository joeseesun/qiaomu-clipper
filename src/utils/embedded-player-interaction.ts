import { containedPictureRect } from './caption-geometry';
import browser from './browser-polyfill';
import { mountEmbeddedFullscreen } from './player-fullscreen';

// Runs only in an iframe owned by an extension page. No access is added to a normal site's player.
export function mountEmbeddedPlayerInteraction(kind:'youtube'|'bilibili'):()=>void {
 if(window.top===window)return ()=>{};
 let origin='';try{const url=new URL(browser.runtime.getURL('/'));origin=`${url.protocol}//${url.host}`;}catch{return ()=>{};}
 const ancestor=location.ancestorOrigins?.[0];if(ancestor&&ancestor!==origin)return ()=>{};
 const stopFullscreen=kind==='youtube'?mountEmbeddedFullscreen(origin):()=>{};
 const visible=(selector:string)=>Array.from(document.querySelectorAll<HTMLElement>(selector)).some(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();if(el.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})===false)return false;return !el.hidden&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'&&rect.width>0&&rect.height>0;});
 const menus=kind==='youtube'?'.ytp-settings-menu,.ytp-popup,[role="menu"]':'.bpx-player-contextmenu,.bpx-player-ctrl-setting-box,.bpx-player-ctrl-playbackrate-menu,.bilibili-player-video-context-menu,[role="menu"]';
 const controls=kind==='youtube'?'.ytp-chrome-bottom':'.bpx-player-control-bottom,.bilibili-player-video-control-bottom';
 let activity=0;
 const tell=()=>{const v=document.querySelector<HTMLVideoElement>('video');if(!v)return;
  const raw=v.getBoundingClientRect(),r=getComputedStyle(v).objectFit==='contain'?containedPictureRect(raw,v.videoWidth,v.videoHeight):raw;
  window.parent.postMessage({picture:{x:r.left,y:r.top,width:r.width,height:r.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight},activity,qiaomuPlayer:'time',time:v.currentTime,paused:v.paused,ready:v.readyState>=1,buffering:v.readyState<3||v.seeking,rate:v.playbackRate,controlsVisible:visible(controls),menuOpen:visible(menus),availableRates:[.5,.75,1,1.25,1.5,1.75,2,3]},origin);
 };
 const message=(event:MessageEvent)=>{
  if(event.source!==window.parent||event.origin!==origin)return;
  const data=event.data,v=document.querySelector<HTMLVideoElement>('video');if(!v||!data||typeof data!=='object')return;
  if(data.qiaomuPlayer==='handoff'&&typeof data.time==='number'&&Number.isFinite(data.time)&&data.time>=0&&typeof data.rate==='number'&&data.rate>=.25&&data.rate<=16&&typeof data.volume==='number'&&data.volume>=0&&data.volume<=1&&typeof data.muted==='boolean'){
   v.currentTime=Math.min(data.time,Number.isFinite(v.duration)?Math.max(0,v.duration-.01):data.time);v.playbackRate=data.rate;v.volume=data.volume;v.muted=data.muted;void v.play().catch(()=>{});tell();
  }
  else if(kind==='bilibili'&&data.qiaomuPlayer==='seek'&&typeof data.time==='number'&&Number.isFinite(data.time)){v.currentTime=Math.max(0,data.time);if(data.play===true)void v.play().catch(()=>{});tell();}
  else if(data.qiaomuPlayer==='skip'&&(data.delta===10||data.delta===-10)){v.currentTime=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:Infinity,v.currentTime+data.delta));tell();}
  else if(data.qiaomuPlayer==='toggle'){if(v.paused)void v.play().catch(()=>{});else v.pause();}
  else if(data.qiaomuPlayer==='rate'&&typeof data.rate==='number'&&[.5,.75,1,1.25,1.5,1.75,2,3].includes(data.rate)){try{v.playbackRate=data.rate;tell();}catch{/* unsupported media */}}
 };
 const types=['playing','pause','waiting','seeking','seeked','ratechange','loadedmetadata','pointerup','pointermove','keydown'];
 let scheduled:ReturnType<typeof setTimeout>|undefined;
 const soon=(event:Event)=>{if(['pointermove','pointerup','keydown'].includes(event.type))activity=Date.now();if(scheduled===undefined)scheduled=setTimeout(()=>{scheduled=undefined;tell();},40);};
 types.forEach(type=>document.addEventListener(type,soon,true));window.addEventListener('message',message);const timer=setInterval(tell,400);tell();
 return ()=>{stopFullscreen();clearInterval(timer);clearTimeout(scheduled);types.forEach(type=>document.removeEventListener(type,soon,true));window.removeEventListener('message',message);};
}
