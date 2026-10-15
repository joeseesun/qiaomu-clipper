import { t } from './ui-text';

export const OPEN_CAPTION_FONTS = [
 {id:'noto-sans-sc',name:'思源黑体 · Noto Sans SC',url:'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'},
 {id:'noto-serif-sc',name:'思源宋体 · Noto Serif SC',url:'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'},
 {id:'wenkai',name:'霞鹜文楷',url:'https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.522/fonts/TTF/LXGWWenKai-Regular.ttf'},
 {id:'inter',name:'Inter',url:'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf'},
 {id:'lora',name:'Lora',url:'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf'},
] as const;
export type CaptionFont = 'system'|'sans'|'serif'|'mono'|`local:${string}`|`open:${string}`;
const legacy:Record<string,string>={system:'system-ui, sans-serif',sans:'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',serif:'Georgia, "Songti SC", SimSun, serif',mono:'ui-monospace, "SFMono-Regular", Consolas, monospace'};
export function validCaptionFont(value:unknown):value is CaptionFont {
 return typeof value==='string'&&(Object.prototype.hasOwnProperty.call(legacy,value)||OPEN_CAPTION_FONTS.some(f=>value==='open:'+f.id)||/^local:[^"\\;{}\n\r]{1,160}$/u.test(value));
}
export function captionFontFamily(value:CaptionFont):string {
 if(value.startsWith('local:'))return `${JSON.stringify(value.slice(6))}, system-ui, sans-serif`;
 if(value.startsWith('open:'))return `"Qiaomu-${value.slice(5)}", system-ui, sans-serif`;
 return legacy[value]||legacy.system;
}
const jobs=new WeakMap<Document,Map<string,Promise<void>>>();
const CACHE='qiaomu-caption-fonts-v1';
const failures=new WeakMap<Document,Set<string>>();
// Download only after selection. Subsequent documents restore the chosen font from the cache.
export async function ensureCaptionFont(doc:Document,value:CaptionFont,retry=false):Promise<void>{
 const font=OPEN_CAPTION_FONTS.find(f=>value==='open:'+f.id);if(!font)return;
 let pending=jobs.get(doc);if(!pending){pending=new Map();jobs.set(doc,pending);}if(retry&&failures.get(doc)?.has(font.id)){pending.delete(font.id);failures.get(doc)?.delete(font.id);}if(pending.has(font.id))return pending.get(font.id);
 const job=(async()=>{
  const Font=doc.defaultView?.FontFace;if(!Font||!doc.fonts)throw new Error(t('当前浏览器不支持此字体'));
  const cache=await globalThis.caches?.open(CACHE);let response=await cache?.match(font.url);
  if(!response){response=await fetch(font.url,{credentials:'omit'});if(!response.ok)throw new Error(t('字体下载失败，请重试'));}
  const bytes=await response.clone().arrayBuffer();if(bytes.byteLength>40*1024*1024)throw new Error(t('字体下载失败，请重试'));
  const face=await new Font(`Qiaomu-${font.id}`,bytes,{weight:font.id==='wenkai'?'400':'100 900'}).load();
  if(cache)await cache.put(font.url,response.clone());(doc.fonts as FontFaceSet & {add:(face:FontFace)=>void}).add(face);
 })();pending.set(font.id,job);try{await job;}catch(error){let failed=failures.get(doc);if(!failed){failed=new Set();failures.set(doc,failed);}failed.add(font.id);throw error;}
}
