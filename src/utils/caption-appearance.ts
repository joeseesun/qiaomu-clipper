import { captionFontFamily, ensureCaptionFont, validCaptionFont, type CaptionFont } from './caption-fonts';
export type { CaptionFont } from './caption-fonts';
import browser from './browser-polyfill';
import { getLocalStorage, setLocalStorage } from './storage-utils';

export const CAPTION_APPEARANCE_KEY = 'qiaomuCaptionAppearance';
export interface CaptionLineStyle { scale:number; weight:number; color:string; font:CaptionFont }
export interface CaptionAppearance { source:CaptionLineStyle; target:CaptionLineStyle; opacity:number; translationFirst:boolean }
export type CaptionPreset = 'standard' | 'cinema' | 'large';
export const captionPreset=(preset:CaptionPreset='standard'):CaptionAppearance=>({source:{scale:preset==='large'?1.15:.85,weight:400,color:'#ffffff',font:'system'},target:{scale:preset==='large'?1.35:1,weight:500,color:'#ffffff',font:'system'},opacity:preset==='cinema'?0:.5,translationFirst:false});
const bounded=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
export function normalizeCaptionAppearance(value:unknown):CaptionAppearance {
 const raw=value && typeof value==='object'?value as any:{},defaults=captionPreset();
 const line=(input:any,fallback:CaptionLineStyle):CaptionLineStyle=>({scale:bounded(input?.scale,.6,2,fallback.scale),weight:[400,500,600,700].includes(input?.weight)?input.weight:fallback.weight,color:typeof input?.color==='string'&&/^#[\da-f]{6}$/i.test(input.color)?input.color:fallback.color,font:validCaptionFont(input?.font)?input.font:fallback.font});
 return {source:line(raw.source,defaults.source),target:line(raw.target,defaults.target),opacity:bounded(raw.opacity,0,1,.5),translationFirst:raw.translationFirst===true};
}
export async function loadCaptionAppearance(){return normalizeCaptionAppearance(await getLocalStorage(CAPTION_APPEARANCE_KEY));}
let pending=Promise.resolve(),saveRevision=0;
export function saveCaptionAppearance(value:CaptionAppearance):Promise<void>{const normalized=normalizeCaptionAppearance(value),revision=++saveRevision;pending=pending.catch(()=>{}).then(()=>revision===saveRevision?setLocalStorage(CAPTION_APPEARANCE_KEY,normalized):undefined);return pending;}
export function watchCaptionAppearance(changed:(value:CaptionAppearance)=>void):()=>void {
 const listener=(changes:Record<string,{newValue?:unknown}>,area:string)=>{if(area==='local'&&changes[CAPTION_APPEARANCE_KEY])changed(normalizeCaptionAppearance(changes[CAPTION_APPEARANCE_KEY].newValue));};
 browser.storage.onChanged?.addListener(listener);
 return ()=>browser.storage.onChanged?.removeListener(listener);
}
export function captionFontSize(width:number,height:number):number {return Math.max(12,Math.min(42,height*.045,width*.032));}
export function applyCaptionAppearance(stack:HTMLElement,source:HTMLElement,target:HTMLElement,settings:CaptionAppearance,base:number){
 stack.style.fontSize=`${base}px`;stack.style.backgroundColor=`rgba(0, 0, 0, ${settings.opacity})`;
 for(const [element,line] of [[source,settings.source],[target,settings.target]] as const){element.style.fontFamily=captionFontFamily(line.font);void ensureCaptionFont(element.ownerDocument,line.font).catch(()=>{});element.style.fontSize=`${line.scale}em`;element.style.fontWeight=String(line.weight);element.style.color=line.color;}
 source.style.order=settings.translationFirst?'1':'0';target.style.order=settings.translationFirst?'0':'1';
}
export interface CaptionPosition { x:number;y:number }
export function normalizeCaptionPosition(value:unknown):CaptionPosition {const raw=value as Partial<CaptionPosition>|null;return {x:bounded(raw?.x,.05,.95,.5),y:bounded(raw?.y,.1,.95,.9)};}
// The anchor is the bottom centre of the subtitle box. Temporary avoidance never rewrites the saved position.
export function captionAnchor(position:CaptionPosition,width:number,height:number,boxWidth:number,boxHeight:number,controlsVisible:boolean):CaptionPosition {
 const safe=8, half=Math.min(width/2,boxWidth/2+safe),bottom=controlsVisible?Math.min(80,height*.28):safe;
 return {x:Math.max(half,Math.min(width-half,position.x*width)),y:Math.max(Math.min(height-safe,boxHeight+safe),Math.min(height-bottom,position.y*height))};
}
export const CAPTION_STYLE=`
html .q-caption-stack{display:flex;position:absolute;flex-direction:column;align-items:center;gap:3px;max-width:84%;width:max-content;box-sizing:border-box;padding:5px 10px;border-radius:5px;transform:translate(-50%,-100%);color:#fff;text-align:center;text-shadow:0 1px 2px #000,0 0 2px #000}
html .q-caption-stack>.q-caption-original,html .q-caption-stack>.q-caption-text{max-width:100%;margin:0!important;padding:0!important;background:none;border:0;line-height:1.35;white-space:pre-line;overflow-wrap:break-word;font-family:system-ui,sans-serif;color:#fff}
html .q-caption-stack>[hidden]{display:none!important}
html .q-caption-editor{display:flex;flex-direction:column;gap:12px;font:400 13px/1.5 system-ui,sans-serif;color:var(--text-normal,#222)}
html .q-caption-editor label{display:flex;align-items:center;gap:10px;justify-content:space-between;font:inherit;color:inherit}
html .q-caption-editor .q-caption-field-label{flex-shrink:0;white-space:nowrap}html .q-caption-editor label{min-width:0;gap:8px}html .q-caption-editor .q-caption-wide{grid-column:1/-1}html .q-caption-range{display:flex;align-items:center;gap:8px;min-width:0;flex:1;justify-content:flex-end}html .q-caption-range output{flex:0 0 42px;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}html .q-caption-editor .q-caption-range input{width:100%!important;max-width:200px;min-width:48px}html .q-caption-editor fieldset{border:0;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;min-width:0}
html .q-caption-editor legend{font-weight:600;margin-bottom:6px}
html .q-caption-editor select{appearance:none!important;width:auto!important;max-width:160px;padding:5px 22px 5px 8px!important;border:1px solid var(--background-modifier-border,#ccc);border-radius:5px;background:var(--background-primary,#fff)!important;color:inherit;font:inherit}
html .q-caption-editor input[type=range]{appearance:none!important;width:100px;height:4px;padding:0!important;border:0!important;border-radius:2px;background:#9996!important;box-shadow:none!important}
html .q-caption-editor input[type=range]::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:var(--text-normal,#555);cursor:pointer}
html .q-caption-editor input[type=range]::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:var(--text-normal,#555);cursor:pointer}
html .q-caption-select{display:inline-flex;position:relative}
html .q-caption-select svg{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:14px;height:14px;pointer-events:none;mix-blend-mode:normal!important}
html .q-caption-editor input[type=color]{appearance:none;width:32px!important;height:24px;padding:2px!important;border:1px solid #9996!important;border-radius:4px;background:transparent!important}
html .q-caption-editor button{appearance:none!important;width:auto!important;padding:5px 9px!important;border:0!important;border-radius:5px;background:var(--background-secondary,#eee)!important;color:inherit!important;box-shadow:none!important;font:inherit;cursor:pointer}
html .q-caption-editor button:hover{background:var(--background-modifier-hover,#ddd)!important}
html .q-caption-editor :is(button,select,input):focus-visible{outline:1px solid var(--text-muted,#777);outline-offset:2px}
html .q-caption-editor .q-caption-preview{position:relative;height:110px;overflow:hidden;border-radius:6px;background:#35424b}
html .q-caption-preview .q-caption-stack{left:50%;top:92%;font-size:17px}
html .q-caption-preset-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
html .q-caption-editor .q-caption-note{margin:0;color:var(--text-muted,#777);font-size:12px}
@media(max-width:500px){html .q-caption-editor .q-caption-field-label{flex-shrink:0;white-space:nowrap}html .q-caption-editor label{min-width:0;gap:8px}html .q-caption-editor .q-caption-wide{grid-column:1/-1}html .q-caption-range{display:flex;align-items:center;gap:8px;min-width:0;flex:1;justify-content:flex-end}html .q-caption-range output{flex:0 0 42px;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}html .q-caption-editor .q-caption-range input{width:100%!important;max-width:200px;min-width:48px}html .q-caption-editor fieldset{grid-template-columns:1fr}}
`;
export function ensureCaptionStyle(doc:Document){if(doc.getElementById('q-caption-appearance-style'))return;const style=doc.createElement('style');style.id='q-caption-appearance-style';style.textContent=CAPTION_STYLE;doc.head.append(style);}
