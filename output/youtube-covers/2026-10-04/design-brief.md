# 视频阅读模式 YouTube 封面候选

生成日期：2026-10-04。工具：内置 imagegen。三张为产品概念插画，不是实际界面截图。功能依据：当前 README.md 的「视频沉浸学习与学习笔记」：字幕阅读、双语翻译、AI 对话、选段及个人笔记存进 Obsidian。

## 最佳实践
- 文字易读、构图简单、准确呈现视频内容，考虑不同设备显示：https://support.google.com/youtube/answer/12340300?hl=en
- 官方目前推荐视频封面采用 16:9、3840×2160；本轮保留生成原图，未宣称原生 4K：https://support.google.com/youtube/answer/72431?hl=en
- 最多三组标题／封面测试，按观看时长评定：https://support.google.com/youtube/answer/16391400?hl=en
- 本轮设计判断：大标题、每张一个主要卖点、三种不同配色和叙事。点击吸引力是待测试假设。

## 候选
1. 01-video-to-book.png：「把视频／变成一本书」。视频展开成书，突出可阅读的体验。建议标题：我给 YouTube 加了阅读模式：双语字幕、AI 提问、Obsidian 笔记。书是视觉隐喻，不意味着导出 EPUB。
2. 02-ask-video.png：「看不懂？／直接问 AI」。字幕高亮连接提问，突出对某一段的理解。建议标题：YouTube 这段没看懂？选中字幕，直接问 AI。
3. 03-learn-save.png：「别再／看完就忘」。视频连接个人笔记，突出留下收获。建议标题：边看 YouTube 边记笔记，把收获存进 Obsidian。

推荐先用 01：最直观表达视频阅读。02 适合 AI 工具受众；03 适合知识管理受众。建议固定同一个标题测试三张封面。

## 质检
三张主标题与副标题文字正确、完整，未裁切；主标题有明显对比，主题一致。小字和场景为生成插画，不能作为实际 UI 功能截图使用。01 的次要信息较多，但主要阅读隐喻清晰；02 的 AI 标识仅为插画示意，产品可配置不同模型；03 的笔记是个人记录，文案没有承诺自动生成。三张均可作封面候选，尚无实测点击率。

## 完整提示词

### 01-video-to-book

Create a finished Chinese YouTube thumbnail for Qiaomu Clipper's video reading/study mode. Landscape EXACT 16:9, ideally 1536x864 or higher. A single polished standalone thumbnail, NOT a contact sheet. Mobile-first: extremely large correct simplified Chinese headline, one dominant visual, strong contrast, generous 6% safe margin, bottom-right corner clear for YouTube duration overlay. Sophisticated tech creator visual with tactile depth and bold editorial typography. Show a conceptual product illustration, not a fake literal screenshot. The real features are video plus timestamped bilingual transcript, context-aware AI questions, and saving selected passages and personal notes to Obsidian. No fabricated percentage/time-saving claims, no shocked celebrity face, no tiny unreadable UI or numerous badges, no watermark. Only the exact specified text may appear. Headline exact two lines: “把视频” then “变成一本书”. Small supporting label “乔木剪藏 · 视频阅读”. Palette warm ivory background, ink-black text, vermilion accent. Left 45% gigantic typography; right 55% a striking sculptural transformation: a red rounded video player tile with white play triangle seamlessly unfolds into an open ivory book with luminous transcript lines and one highlighted passage. The player remains visually integrated with the book, conveying readable video, not a promise of EPUB export. Subtle cinematic shadow and realistic paper texture, elegant minimalist 3D editorial collage. Accent “一本书” with vermilion. Headline is the hero and readable at 320px wide.

### 02-ask-video

Create a finished Chinese YouTube thumbnail for Qiaomu Clipper's video reading/study mode. Landscape EXACT 16:9, ideally 1536x864 or higher. A single polished standalone thumbnail, NOT a contact sheet. Mobile-first: extremely large correct simplified Chinese headline, one dominant visual, strong contrast, generous 6% safe margin, bottom-right corner clear for YouTube duration overlay. Sophisticated tech creator visual with tactile depth and bold editorial typography. Show a conceptual product illustration, not a fake literal screenshot. The real features are video plus timestamped bilingual transcript, context-aware AI questions, and saving selected passages and personal notes to Obsidian. No fabricated percentage/time-saving claims, no shocked celebrity face, no tiny unreadable UI or numerous badges, no watermark. Only the exact specified text may appear. Headline exact two lines: “看不懂？” then “直接问 AI”. Small supporting label “乔木剪藏 · 视频阅读”. Palette midnight navy, brilliant white and electric lime. Left 48% oversized thick white typography, “问 AI” lime. Right 52% dramatic clean floating video pane with red play triangle above a large ivory transcript card, one highlighted sentence connected by a single lime curved connector to a bold AI reply bubble. Reply bubble exact text “这段是什么意思？”. Video contains abstract original cinematic imagery of a lecturer silhouette, no recognizable face or borrowed screenshot. Keep objects large and restrained. Crisp tech thumbnail with depth and intelligent curiosity, no decorative particles or light rays.

### 03-learn-save

Create a finished Chinese YouTube thumbnail for Qiaomu Clipper's video reading/study mode. Landscape EXACT 16:9, ideally 1536x864 or higher. A single polished standalone thumbnail, NOT a contact sheet. Mobile-first: extremely large correct simplified Chinese headline, one dominant visual, strong contrast, generous 6% safe margin, bottom-right corner clear for YouTube duration overlay. Sophisticated tech creator visual with tactile depth and bold editorial typography. Show a conceptual product illustration, not a fake literal screenshot. The real features are video plus timestamped bilingual transcript, context-aware AI questions, and saving selected passages and personal notes to Obsidian. No fabricated percentage/time-saving claims, no shocked celebrity face, no tiny unreadable UI or numerous badges, no watermark. Only the exact specified text may appear. Headline exact two lines: “别再” then “看完就忘”. Small supporting label “边看边记，存进 Obsidian”. Palette saturated golden yellow background, charcoal black headline, rich violet accent. Left 48% exceptionally large readable black text. Right 52% one expressive transformation: dark video card with red play triangle at upper right, below it a beautiful large ivory personal note card with a violet folded corner and a single thick violet directional arrow from video to notes. Note card exact large heading “我的收获”, below only three broad graphical writing strokes and a purple highlighted passage, no tiny gibberish. Small violet faceted crystal symbol integrated at note corner suggesting a knowledge notebook, not huge logo. Bold editorial graphic with subtle physical paper shadows, premium and striking, no clutter, no exaggeration of automatic note taking; visual is watching and leaving personal notes.

