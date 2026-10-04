# README 截图与功能核对

核对日期：2026-10-04。新增截图以 `main` 的 `70eba99` 为基线，独立文档分支不包含其他工作区尚未提交的功能修改。

## 图片来源

| 图片 | 展示内容 | 数据与边界 |
|---|---|---|
| `assets/screens/video-study.png` | 统一顶栏、视频布局切换、尺寸分隔线、字幕搜索、双语显示 | 使用生产 `clip-bar`、`reader-transcript`、`youtube-study` 与阅读样式；本地封面预览，字幕和译文为说明交互的示例，并非该视频的完整实取字幕 |
| `assets/screens/youtube-transcript-bar.png` | 原页常驻转写条、搜索、当前行与时间跳转入口 | 生产 `youtube-transcript-bar` 组件独立预览；使用示例字幕，非完整 YouTube 原页截图 |
| `assets/screens/learning-note.png` | 不中断学习的笔记卡片、我的理解、时间点、日记目标 | 生产 `learning-composer` 与草稿逻辑；日记目标为演示返回值，没有连接用户库或执行写入 |
| `assets/screens/ai-settings.png` | 字体、字号、全局指令、快捷提示词 | 生产 `clip-chat` 设置面板；示例指令，无真实模型请求 |
| `assets/screens/reader.png`、`reader-chat.png`、`editor.png`、`popup.png` | 普通阅读、选中文字问 AI、整页编辑和剪藏弹窗 | 保留仓库此前截图；生产页面样式渲染，自拟示例文章与演示回答，部分旧截图不含最新的笔记/设置/目录按钮 |

新增图片由 ego-browser 对本地组件预览直接截图，未修图。预览隔离浏览器存储、本地助手和模型接口，不访问真实笔记库，不提交 RSS。组件截图用于理解界面与工作流程；播放器实播、真实字幕获取、模型质量、日记落盘和跨窗口恢复需在已安装扩展中分别验收。

## 最近功能覆盖

| 功能组 | 核对实现 | README 位置 |
|---|---|---|
| 先入学习页，字幕异步加载、超时原地重试 | `youtube-study-loader`、`reader-preview-shell` | 视频学习 |
| YouTube / B 站学习与能力差异 | `video-source`、`youtube-study`、`reader-transcript` | 视频学习、隐私与边界 |
| 停靠、剧场、角落小窗、尺寸拖动、YouTube Document PiP | `youtube-player-size`、`youtube-player-mode` | 视频学习 |
| 原页转写条、字幕搜索、播放跟随、滚动礼让、缓存、原生面板回退 | `youtube-panel-content`、`youtube-transcript-bar` | YouTube 原页、视频学习 |
| 中英对照翻译、取消、重试、保留时间戳 | `youtube-translation` | 视频学习 |
| 学习笔记卡片、摘录、AI 加入、草稿、日记目标确认、保存标记 | `learning-composer`、`learning-record`、`native/host.py` | 学习笔记、快速开始 |
| AI 外观、全局指令、文章/选区快捷提示词、历史与调整面板宽度 | `clip-chat`、`chat-preferences`、`chat-history` | AI 对话 |
| 共用顶栏、目录折叠、字体、高亮、编辑草稿 | `clip-bar`、`sidebar-toggle`、`reader`、`editor-script` | 阅读与编辑 |
| 默认模板、模板规则、AI 变量、三连击和站点禁用 | `storage-utils`、`triple-key`、`triple-key-content` | 弹窗、快捷键、AI 对话 |
| 本地保存、日记助手、公开 RSS 开关及结果分离 | `clip-preview`、`reader-source-draft`、`learning-record`、`native` | 快速开始、隐私与边界 |

这是功能与文档的对应表，不表示上述能力在所有浏览器、视频或用户配置中均已实机通过。旧下载包与当前源码的差异已经放在 README 安装入口旁。
