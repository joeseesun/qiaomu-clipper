import { loadCaptionAppearance, saveCaptionAppearance, watchCaptionAppearance } from '../utils/caption-appearance';
import { captionStyleEditor } from '../utils/caption-style-editor';
import { t } from '../utils/ui-text';

export async function initializeCaptionSettings():Promise<void>{
 const holder=document.getElementById('caption-appearance-settings');if(!holder)return;
 const editor=captionStyleEditor(document,await loadCaptionAppearance(),value=>{void saveCaptionAppearance(value).then(()=>{status.textContent=t('已保存');}).catch(()=>{status.textContent=t('字幕样式保存失败');});});
 const status=document.createElement('p');status.className='setting-item-description';status.setAttribute('role','status');holder.replaceChildren(editor.element,status);
 const stop=watchCaptionAppearance(value=>editor.set(value));window.addEventListener('pagehide',stop,{once:true});
}
