// Actual product components + original example content. Not an external-service acceptance test.
import { marked } from 'marked';
import { initializeI18n } from '../../../../src/utils/i18n';
import { loadSettings } from '../../../../src/utils/storage-utils';
import { startWritePage } from '../../../../src/write/page';
import { blankArticle, saveArticle } from '../../../../src/write/articles';
import { saveChat } from '../../../../src/write/ai/chat-store';
import { saveConversation } from '../../../../src/utils/chat-history';
import { mountReaderPreviewShell } from '../../../../src/utils/reader-preview-shell';
import { mountImageLibrary } from '../../../../src/utils/image-library';
import { saveLibraryImage, writeImageJob } from '../../../../src/utils/image-library-store';
import { wireTranscript } from '../../../../src/utils/reader-transcript';
import { mountYouTubeStudy } from '../../../../src/utils/youtube-study';
import { setUiLanguage } from '../../../../src/utils/ui-text';
import { renderBilingualBlocks } from '../../../../src/utils/transcript-format';

const mode = new URLSearchParams(location.search).get('mode') || 'write';
const title = '把一次阅读，变成自己的想法';
const url = 'https://example.org/learning-by-making';
const markdown = `> 阅读的终点，不是合上页面，而是多了一个自己的问题。

## 01 先留下一个问题

读完一篇文章后，先别急着收藏。问自己：**哪一个观点，改变了我原来的看法？** 把它写下来，再带着这个问题回到原文。

## 02 把理解写成自己的话

试着不用原文的句子，向朋友解释这个观点。解释不清楚的地方，就是值得继续追问的地方。

| 读到的内容 | 我的理解 | 下一步行动 |
| --- | --- | --- |
| 主动回忆 | 合上资料，自己讲一次 | 写一段 100 字笔记 |
| 间隔练习 | 过一段时间，再试着回想 | 明天重新回答这个问题 |
| 联系旧知识 | 找到与已有经验的连接 | 补一个自己的例子 |

## 03 做出一个小作品

一篇笔记、一段讲解，甚至是一张配图，都能让抽象的理解变得具体。保留来源，区分作者的观点和自己的判断，慢慢形成可复用的材料。

## 我的下一步

- [ ] 写下今天最想继续追问的一个问题
- [ ] 用自己的例子解释它
- [ ] 把笔记留给未来的自己
`;
const now = Date.now();
await initializeI18n(); setUiLanguage('zh_CN'); await loadSettings();
document.documentElement.lang = 'zh-CN';
document.documentElement.classList.add('theme-light');
if (mode === 'write') {
  document.documentElement.id = 'write-page';
  document.body.innerHTML = '<div id="write-root"></div>';
  const article = await saveArticle({...blankArticle(), id:'store-demo-writing', title, markdown, author:'乔木剪藏 · 示例内容', sourceUrl:url});
  await saveChat(article.id, [{id:'store-demo-chat',title:'梳理这篇文章',updatedAt:now,messages:[
    {role:'user', content:'帮我把这篇文章整理成更清楚的三步结构。'},
    {role:'assistant',content:'可以用一条读者容易跟上的线索：\n\n**1. 留下问题**\n读完后，先抓住一个让你改变想法的观点。\n\n**2. 写出理解**\n用自己的话解释它，再补一个自己的例子。\n\n**3. 做出作品**\n把理解写成笔记或文章，留下以后可以继续使用的材料。\n\n这样，每一步都有一个具体动作，也自然承接下一步。'},
  ]}]);
  history.replaceState(null,'',`?mode=write&id=${article.id}`);
  await startWritePage(document.getElementById('write-root')!);
} else if (mode === 'gallery') {
  document.body.className = 'image-library-page';
  document.body.innerHTML = '<main id="image-library"></main>';
  const blob = await (await fetch('/sample-brand.png')).blob();
  await saveLibraryImage(blob,{id:'store-cover',name:'阅读与创作 · 概念封面',source:'generated',created:now,prompt:'让阅读成为自己的作品',width:1984,height:800,modelLabel:'示例图片'});
  // Reuse project-owned illustrations rather than remote or private user pictures.
  for (const [id,name] of [['video-reading','视频学习'],['reader-highlights','专注阅读'],['learning-notes','学习笔记'],['markdown-editor','Markdown 写作'],['ai-chat','文章问答']]) {
    const pic = await (await fetch(`/examples/${id}.jpg`)).blob();
    await saveLibraryImage(pic,{id:`demo-${id}`,name,source:'upload',created:now-60000});
  }
  await writeImageJob({id:'demo-finished',created:now,prompt:'阅读与创作 · 概念封面',aspect:'16:9',configId:'demo',modelId:'demo',modelLabel:'示例图片',state:'ready',imageId:'store-cover'});
  mountImageLibrary(document.getElementById('image-library')!);
} else {
  document.documentElement.id = 'reader-page';
  document.documentElement.classList.add('obsidian-reader-active','qiaomu-preview');
  document.documentElement.style.setProperty('--font-text-size','19px');
  document.documentElement.style.setProperty('--line-height-normal','1.8');
  document.documentElement.style.setProperty('--line-width','38em');
  document.body.innerHTML = '<div class="obsidian-reader-container"><div class="obsidian-reader-left-sidebar is-empty"></div><div class="obsidian-reader-content"><main><article></article></main></div><div class="obsidian-reader-right-sidebar"></div></div>';
  const article = document.querySelector('article')!;
  const isStudy = mode === 'study';
  article.innerHTML = isStudy ? `<h1>让阅读变成理解</h1><p>学习方法 · 示例片段</p><div class="reader-video-wrapper"><video class="reader-video-player" controls poster="/sample-brand.png"></video></div><div class="transcript youtube"><h2>文字稿</h2>${[
    ['00:12','Learning starts with a question of your own.','学习，从一个属于自己的问题开始。'],
    ['00:28','Try to explain the idea without looking at the page.','试着离开原文，用自己的话解释这个观点。'],
    ['00:46','Connect what you read to something you already know.','把新读到的内容，和已有的经验连接起来。'],
    ['01:08','Make a small thing that you can share or use.','做出一个可以分享、也可以使用的小作品。'],
    ['01:32','Keep the source, and leave room for your own thoughts.','保留来源，也给自己的想法留下位置。'],
  ].map(([time,en,zh],i)=>`<p class="transcript-segment" data-demo-translation="${zh}"><strong><span class="timestamp" data-timestamp="${12+i*20}" data-end="${32+i*20}">${time}</span></strong> ${en}</p>`).join('')}</div>` : `<h1>${title}</h1><p>乔木剪藏 · 阅读示例　/　5 分钟</p>${await marked.parse(markdown)}`;
  const draft:any = {local:{requestId:'store-demo-reader',title,filename:title+'.md',content:markdown},clip:{title,url,markdown,content:markdown},native:false,aggregate:false,properties:[],createdAt:now};
  await saveConversation(url,title,{id:'store-demo-conversation',title:'用自己的例子解释',updatedAt:now,messages:[
    {role:'user',content:'用一个具体例子，解释“读过”和“学会”的区别。',quote:'解释不清楚的地方，就是值得继续追问的地方。'},
    {role:'assistant',content:'比如你读完一篇关于摄影构图的文章。\n\n**读过**：你记得“三分法”这个词。\n\n**学会**：你拿起手机，把主体放在画面右侧，拍一张照片，再解释这样构图为什么更合适。\n\n回到这篇文章，可以先做一个小动作：合上页面，用自己的话写下最有用的那个观点。'},
  ]});
  const shell = mountReaderPreviewShell(draft);
  if (mode === 'chat') { shell.chat.toggle(true); shell.chat.quote('解释不清楚的地方，就是值得继续追问的地方。'); }
  if (isStudy) {
    wireTranscript(document,article,{pinPlayer:true,autoScroll:true,highlightActiveLine:true},{getStickyOffset:()=>50,scrollTo:y=>window.scrollTo(0,y),programmaticScroll:()=>false});
    await mountYouTubeStudy(document,article,title,url,shell.chat);
    for (const segment of article.querySelectorAll<HTMLElement>('.transcript-segment')) {
      const source = segment.querySelector<HTMLElement>('.transcript-segment-text')!;
      renderBilingualBlocks(source,[{original:source.textContent!.trim(),translation:segment.dataset.demoTranslation!}]);
    }
    const translated = article.querySelector<HTMLInputElement>('.youtube-translate-toggle input');
    if (translated) { translated.checked=true; translated.closest('label')!.classList.add('is-enabled'); }
  }
}
document.body.dataset.ready = 'true';
