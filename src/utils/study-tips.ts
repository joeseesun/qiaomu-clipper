import { createElement, Lightbulb, ChevronRight, X } from 'lucide';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { t } from './ui-text';
const KEY='qiaomuStudyTipsDismissed';
export const studyTips=()=>[
 t('播放器聚焦时，K 或空格播放／暂停，J 回退 10 秒，L 前进 10 秒。'),
 t('在原网页，默认连按三次 A 进入阅读／学习模式，连按三次 I 快速记笔记。'),
 t('按住字幕上的拖动手柄调整位置，点击「完成」保存。'),
 t('在「字幕样式」中选择开源字体，即可自动加载并应用。'),
 t('已有字幕也能点击「换模型生成字幕」，选择另一个模型重新生成。'),
 t('点击文稿时间戳，可跳回对应片段；搜索字幕可快速找到关键词。'),
 t('开启「字幕滚动」，文稿会跟随播放；切换停靠、剧场或小窗，选择适合你的布局。'),
 t('支持的播放器可进入全屏或画中画，也可调整播放速度，最高 3 倍速。'),
 t('双语字幕、文稿中文译文和剪藏内容可以分别选择，按你的需要保留原文或译文。'),
 t('字幕语言选择框可切换视频提供的官方字幕，不会重新生成字幕。'),
 t('复制或下载字幕文本时，会按当前显示方式导出，并保留时间戳。'),
 t('在「转写学习」中粘贴媒体链接或选择本地音视频文件，即可生成文稿并学习。'),
 t('「转写学习」还可浏览推荐播客；「最近学习」可以重新打开已学内容。'),
 t('生成字幕可选本机模型或云端服务；云端音频只发送给你选择的服务。'),
 t('在语音识别设置中保存多个模型，并设置默认模型和不同来源的专用模型。'),
 t('阅读或学习页按 N 打开笔记卡片；选中文字后记笔记，可同时带入摘录。'),
 t('笔记卡片可补充自己的理解和 AI 回答，保存到今天的 Obsidian 日记。'),
 t('在原网页默认连按三次 E 进入整页编辑，连按三次 Q 按默认模板剪藏。'),
 t('阅读页可以调整字体、字号、行距和配色；划线重点可在设置中集中查看、搜索和导出。'),
 t('AI 面板可围绕全文、选中段落或图片提问，回答可以复制或加入笔记。'),
 t('AI 面板会按文章保留对话；可保存常用提示词和全局指令，并调整面板宽度与字号。'),
 t('剪藏模板可指定笔记库、目录、属性与正文，按网址自动匹配，还可使用 AI 提示变量。'),
 t('弹窗和阅读页可复制或下载 Markdown，也可先编辑标题和正文再保存到 Obsidian。'),
 t('勾选「分享到乔木 RSS」会公开分享剪藏内容；保存学习笔记不会触发分享。'),
 t('支持的媒体可下载完整音视频；Chrome 商店版不提供 YouTube 音视频文件下载。'),
 t('设置中可自定义三连击按键、关闭某个快捷键或按网站禁用，也可导出和导入设置。'),
];
export function mountStudyTips(container:HTMLElement){
 const doc=container.ownerDocument,root=doc.createElement('aside');root.className='q-study-tips';root.hidden=true;root.setAttribute('aria-label',t('小技巧'));
 const title=doc.createElement('strong');title.append(createElement(Lightbulb),doc.createTextNode(t('小技巧')));
 const text=doc.createElement('span');text.className='q-study-tip-text';text.setAttribute('aria-live','polite');
 const tips=studyTips();

 let index=Math.floor(Math.random()*tips.length),disposed=false,dismissed=false;
 const next=doc.createElement('button');next.type='button';next.title=t('下一条');next.setAttribute('aria-label',next.title);next.append(createElement(ChevronRight));next.onclick=()=>{index=(index+1)%tips.length;text.textContent=tips[index];};
 const close=doc.createElement('button');close.type='button';close.title=t('关闭小技巧');close.setAttribute('aria-label',close.title);close.append(createElement(X));close.onclick=()=>{dismissed=true;root.hidden=true;void setLocalStorage(KEY,true).catch(()=>{});};
 text.textContent=tips[index];root.append(title,text,next,close);container.append(root);
 // The player toolbar is mounted asynchronously; keep the tips after it in every layout.
 const place=()=>{const toolbar=container.querySelector(':scope > .player-toggles');if(toolbar&&root.previousElementSibling!==toolbar)toolbar.after(root);};
 place();const observer=new MutationObserver(place);observer.observe(container,{childList:true});
 void getLocalStorage(KEY).then(value=>{if(!disposed&&!dismissed)root.hidden=value===true;}).catch(()=>{if(!disposed&&!dismissed)root.hidden=false;});
 if(!doc.getElementById('q-study-tips-style')){const style=doc.createElement('style');style.id='q-study-tips-style';style.textContent=`html .q-study-tips{display:flex;align-items:center;gap:8px;grid-column:1 / -1;grid-row:4;order:100;min-width:0;box-sizing:border-box;width:100%;margin:8px 0 0;padding:9px 10px;background:var(--background-secondary,#f5f5f5);color:var(--text-muted,#666);border-radius:5px;font:400 12px/1.6 system-ui,sans-serif}html .q-study-tips[hidden],html .player-container:fullscreen .q-study-tips{display:none!important}html .q-study-tips strong{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-weight:500}html .q-study-tip-text{flex:1;min-width:0}html .q-study-tips svg{width:14px;height:14px;flex-shrink:0;mix-blend-mode:normal!important}html .q-study-tips button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:26px!important;height:26px;padding:0!important;margin:0;border:0;border-radius:4px;background:transparent;box-shadow:none;color:inherit;cursor:pointer}html .q-study-tips button:hover{background:var(--background-modifier-hover,#ddd)}html .q-study-tips button:focus-visible{outline:1px solid currentColor;outline-offset:2px}`;doc.head.append(style);}
 return ()=>{disposed=true;observer.disconnect();root.remove();};
}
