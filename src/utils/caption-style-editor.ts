import { OPEN_CAPTION_FONTS, captionFontFamily, ensureCaptionFont, type CaptionFont } from './caption-fonts';
import { createElement, ChevronDown } from 'lucide';
import { applyCaptionAppearance, captionPreset, ensureCaptionStyle, normalizeCaptionAppearance, type CaptionAppearance, type CaptionLineStyle, type CaptionPreset } from './caption-appearance';
import { t } from './ui-text';

// The same editor is used beside the video and in global settings. All changes preview immediately.
export function captionStyleEditor(doc:Document,initial:CaptionAppearance,changed:(value:CaptionAppearance)=>void){
 ensureCaptionStyle(doc);let value=normalizeCaptionAppearance(initial),stateRevision=0;
 const root=doc.createElement('div');root.className='q-caption-editor';
 const preview=doc.createElement('div');preview.className='q-caption-preview';preview.setAttribute('aria-label',t('字幕预览'));
 const stack=doc.createElement('div');stack.className='q-caption-stack';const source=doc.createElement('div');source.className='q-caption-original';source.textContent='Your front row seat to the future.';const target=doc.createElement('div');target.className='q-caption-text';target.textContent=t('在前排，见证未来。');stack.append(source,target);preview.append(stack);root.append(preview);
 const setters:Array<()=>void>=[];
 const paint=()=>{applyCaptionAppearance(stack,source,target,value,17);setters.forEach(set=>set());};
 const update=()=>{stateRevision++;paint();changed(normalizeCaptionAppearance(value));};
 const presets=doc.createElement('div');presets.className='q-caption-preset-row';
 for(const [preset,label] of [['standard',t('标准')],['cinema',t('影院')],['large',t('大字')]] as const){const button=doc.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>{value=captionPreset(preset as CaptionPreset);update();};presets.append(button);}root.append(presets);
 const label=(parent:HTMLElement,text:string,control:HTMLElement)=>{const row=doc.createElement('label');const name=doc.createElement('span');name.className='q-caption-field-label';name.textContent=text;row.append(name,control);parent.append(row);return row;};
 const select=(parent:HTMLElement,text:string,options:Array<[string,string]>,get:()=>string,set:(next:string)=>void)=>{const input=doc.createElement('select');input.setAttribute('aria-label',text);options.forEach(([v,name])=>{const opt=doc.createElement('option');opt.value=v;opt.textContent=name;input.append(opt);});const wrap=doc.createElement('span');wrap.className='q-caption-select';wrap.append(input,createElement(ChevronDown));label(parent,text,wrap);input.onchange=()=>{set(input.value);update();};setters.push(()=>input.value=get());};
 const range=(parent:HTMLElement,text:string,min:number,max:number,step:number,get:()=>number,set:(next:number)=>void)=>{const wrap=doc.createElement('span'),input=doc.createElement('input'),output=doc.createElement('output');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',text);wrap.className='q-caption-range';wrap.append(input,output);label(parent,text,wrap).classList.add('q-caption-wide');input.oninput=()=>{set(Number(input.value));update();};setters.push(()=>{input.value=String(get());output.textContent=` ${Math.round(get()*100)}%`;input.setAttribute('aria-valuetext',output.textContent.trim());});};
 const fontNotice=doc.createElement('p');fontNotice.className='q-caption-note';fontNotice.setAttribute('role','status');
 const fontOptions=(input:HTMLSelectElement,locals:Array<{id:string;name:string}>=[])=>{
  input.replaceChildren();const add=(parent:HTMLElement,id:string,name:string)=>{const option=doc.createElement('option');option.value=id;option.textContent=name;option.style.fontFamily=captionFontFamily(id as CaptionFont);parent.append(option);};
  add(input,'system',t('跟随系统'));
  const group=doc.createElement('optgroup');group.label=t('开源字体（首次使用下载）');for(const font of OPEN_CAPTION_FONTS)add(group,'open:'+font.id,font.name);input.append(group);
  const local=doc.createElement('optgroup');local.label=t('本机字体');for(const font of locals)add(local,font.id,font.name);
  for(const key of ['source','target'] as const){const id=value[key].font;if(id.startsWith('local:')&&!locals.some(f=>f.id===id)&&!Array.from(local.children).some(o=>(o as HTMLOptionElement).value===id))add(local,id,id.slice(6));}
  if(local.children.length)input.append(local);
  // Keep existing preferences visible while migrating to named fonts.
  for(const [id,name] of [['sans','Arial / 苹方 / 微软雅黑'],['serif','Georgia / 宋体'],['mono','SF Mono / Consolas']])add(input,id,name);
 };
 const line=(key:'source'|'target',title:string)=>{
  const field=doc.createElement('fieldset'),legend=doc.createElement('legend');legend.textContent=title;field.append(legend);root.append(field);
  const font=doc.createElement('select');font.setAttribute('aria-label',t('字体'));fontOptions(font);const fontWrap=doc.createElement('span');fontWrap.className='q-caption-select';fontWrap.append(font,createElement(ChevronDown));label(field,t('字体'),fontWrap).classList.add('q-caption-wide');
  let request=0;font.onchange=async()=>{const id=font.value as CaptionFont,revision=++request,startingState=stateRevision;font.disabled=true;fontNotice.textContent=id.startsWith('open:')?t('正在下载字体…'):'';try{await ensureCaptionFont(doc,id,true);if(request!==revision||stateRevision!==startingState){paint();return;}value[key].font=id;update();fontNotice.textContent='';}catch(error){if(request===revision){fontNotice.textContent=error instanceof Error?error.message:t('字体下载失败，请重试');paint();}}finally{if(request===revision)font.disabled=false;}};
  setters.push(()=>{font.value=value[key].font;});
  range(field,t('字号'),.6,2,.05,()=>value[key].scale,next=>value[key].scale=next);
  select(field,t('字重'),[['400',t('常规')],['500',t('中等')],['600',t('半粗')],['700',t('粗体')]],()=>String(value[key].weight),next=>value[key].weight=Number(next));
  const color=doc.createElement('input');color.type='color';color.setAttribute('aria-label',t('文字颜色'));label(field,t('文字颜色'),color);color.oninput=()=>{value[key].color=color.value;update();};setters.push(()=>color.value=value[key].color);
 };
 line('source',t('原文字幕'));line('target',t('中文字幕'));root.append(fontNotice);
 range(root,t('背景不透明度'),0,1,.05,()=>value.opacity,next=>value.opacity=next);
 select(root,t('双语顺序'),[['source',t('原文在上')],['target',t('中文在上')]],()=>value.translationFirst?'target':'source',next=>value.translationFirst=next==='target');
 const reset=doc.createElement('button');reset.type='button';reset.textContent=t('恢复默认样式');reset.onclick=()=>{value=captionPreset();update();};root.append(reset);
 const note=doc.createElement('p');note.className='q-caption-note';note.textContent=t('仅改变播放器字幕，不影响文稿翻译和剪藏内容。');root.append(note);paint();
 return {element:root,set:(next:CaptionAppearance)=>{stateRevision++;value=normalizeCaptionAppearance(next);paint();}};
}
