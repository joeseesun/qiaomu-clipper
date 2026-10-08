# 乔木剪藏 Chrome Web Store 提交资料

资料日期：2026-10-06。以下内容按当前源代码与 Google 官方文档准备；资料齐备、后台草稿、提交审核和正式上架是不同状态。账号、联系方式、分发范围及后台认证以实际发布者配置为准。

## 文件与链接

- 上传包：`builds/store-upload/qiaomu-clipper-1.14.1-chrome.zip`（构建后检查 ZIP 根目录 manifest.json）
- 项目主页：https://github.com/joeseesun/qiaomu-clipper
- 支持地址：https://github.com/joeseesun/qiaomu-clipper/issues
- 隐私政策：https://joeseesun.github.io/qiaomu-clipper/privacy.html
- 单一目的、权限和数据申报：见下文，需与后台实际字段及上传 Manifest 一致。
- 类别建议：Productivity（以后台实际可用分类为准）；费用：扩展免费，用户自己的 AI 服务可能收费。
- 开发者联系邮箱：由发布者提供/后台验证，不能用猜测的地址。
- 名称：乔木剪藏 · Obsidian + RSS（匹配 Manifest）

## 中文商店介绍

短介绍：剪藏网页到 Obsidian，阅读、编辑 Markdown，并用自己的 AI 模型提问；可选择分享到乔木 RSS。

详细介绍：

把网页或选中文字整理成 Obsidian Markdown 笔记。在保存前，你可以先阅读、修改标题和属性、编辑正文，也可以复制或下载 Markdown。

主要功能：
• 简洁剪藏面板：阅读、编辑、复制、下载与保存入口。
• 阅读模式：清晰排版、可调字体和配色、划线高亮。
• 整页编辑器：编辑标题、属性和 Markdown，阅读与编辑之间切换。
• 文章 AI 对话：全文或选中片段提问、流式回答、复制回答或加入笔记，历史对话保存在本机。
• 模板：配置保存位置、属性、正文和可选 AI 提示，按网页规则选择模板。
• 快捷操作：默认连按三次 A 阅读、E 编辑、Q 剪藏，可更改、关闭或按网站禁用；在输入框内打字不触发。
• 视频学习：YouTube、B 站及 TED 官方字幕，字幕搜索、点击时间戳跳转、随播放滚动；原文、译文或双语复制、下载与剪藏。
• 沉浸学习页：视频与字幕同屏、剧场模式、悬浮与画中画，结合 AI 问答和学习日记。
• 生成字幕：可选本机或用户配置的云端语音服务；支持媒体链接及本地音视频文件，需安装本地助手。网站兼容性取决于平台和登录状态。
• 快捷笔记：连按三次 I 打开笔记卡片，可附选区、来源及文件，保存到 Obsidian 日记。
• AI 设置：服务商卡片、搜索和多模型选择，新增可选账号登录入口。
• 可选公开分享：勾选“分享到乔木 RSS”后，剪藏会公开提交链接、标题、正文和封面。

使用前请了解：
1. 保存到 Obsidian 需要你安装 Obsidian；也可只复制/下载 Markdown。
2. 不打开 Obsidian 的静默保存需要另装本地 Native Messaging 助手，支持 macOS/Linux Chrome；Windows 已有安装支持，尚待真机验证。商店安装不会自动安装该助手。
3. AI 功能需要你自行配置服务商、模型及凭证，费用按服务商规则计算。文章内容、提示词和对话会发送给你选择的服务商。
4. “分享到乔木 RSS”默认不勾选。开启后内容会公开发布，请在剪藏私人页面前确认；阅读和编辑本身不会提交 RSS。
5. 本项目基于 Obsidian Web Clipper 独立开发，保留 MIT 许可；不是 Obsidian 官方扩展，也不代表 Obsidian 官方。

支持与反馈：https://github.com/joeseesun/qiaomu-clipper/issues
隐私政策：https://joeseesun.github.io/qiaomu-clipper/privacy.html

## English store listing

Short description:
Clip web pages to Obsidian, read and edit Markdown, ask your own AI models, and optionally share clips to Qiaomu RSS.

Detailed description:

Turn web pages or selected passages into Obsidian Markdown notes. Preview the article, edit its title, properties and Markdown, or copy/download the draft before saving.

Features:
• Compact clipping panel with read, edit, copy, download and save actions.
• Clean reading mode with adjustable fonts/themes and highlights.
• Full-page Markdown and property editor, with a shared read/edit toolbar.
• Article AI chat: ask about the whole article or a selected passage, stream answers, copy them or add them to your note. Conversation history stays in local browser storage.
• Templates for folders, properties, Markdown and optional AI prompts.
• Configurable triple-press shortcuts: A to read, E to edit, Q to clip. Disable them per action or per website. Typing in editable fields does not trigger them.
• Video study with YouTube, Bilibili and TED captions: search, click timestamps to seek, follow playback and copy/download/clip original or bilingual transcripts.
• An immersive player and transcript workspace with theater, floating and picture-in-picture modes, AI chat and learning notes.
• Generate subtitles with an on-device engine or your chosen cloud speech service using the separately installed helper. Accepts supported media links and local audio/video files; site availability depends on the platform and login state.
• Triple-press I to take a quick note with optional excerpts, sources and file attachments in an Obsidian daily note.
• Searchable provider cards, multiple model selection and optional account sign-in entries.
• Optional public sharing to Qiaomu RSS.

Requirements and privacy:
Obsidian must be installed for the Obsidian save workflow; Markdown copy/download works without it. Silent saving requires a separately installed Native Messaging helper for macOS/Linux Chrome, with Windows installation support covered by tests and awaiting device validation. The helper is not bundled with the store installation.
AI features require your own provider/model and credentials. Content, prompts and conversation context are sent to your configured provider, whose fees and terms apply.
Share to Qiaomu RSS is off by default. Clipping with it enabled publicly submits the URL, title, Markdown and optional cover image. Keep it off for private content. Reading/editing alone does not submit RSS content.
This is an independent project based on Obsidian Web Clipper under MIT, not an official Obsidian extension.

Support: https://github.com/joeseesun/qiaomu-clipper/issues
Privacy: https://joeseesun.github.io/qiaomu-clipper/privacy.html

## Privacy practices — copy-ready English fields

Single purpose:
Help users turn web articles and audio/video transcripts into Obsidian Markdown learning notes: extract or generate content, read/edit/study it, optionally ask their chosen AI provider, then save locally or explicitly share a clip to a public RSS feed.

| Permission | Justification |
|---|---|
| activeTab | Identify and access the page the user chooses to clip via the toolbar, context menu or shortcut. |
| scripting | Inject the bundled extraction, highlighting, reading and clipping scripts into the selected page. No remotely hosted code is injected. |
| storage | Store templates, settings, local chat history, clip drafts, pending retries and the anonymous RSS client ID. Some preferences/templates use Chrome sync storage. |
| clipboardWrite | Copy Markdown/property values at the user's request and support the Obsidian URI fallback save workflow. |
| nativeMessaging | Communicate with the optional, separately installed local helper to choose a vault/folder and save Markdown/attachments and learning notes inside that vault, and perform user-requested media download and subtitle generation with the selected local/cloud engine. No helper is installed automatically. |
| contextMenus | Provide user-invoked clipping and highlighting actions from the page context menu. |
| sidePanel | Display the clipping interface in Chrome's side panel when requested. |
| declarativeNetRequest | Apply bundled, narrowly filtered YouTube embed and youtubei header rules required by the inherited article-reader/video functionality. Not used to block advertising or track traffic. |
| http://*/* and https://*/* | Support clipping and reading arbitrary websites, the persistent configurable triple-press shortcut listener/content loader, and requests to user-configured AI endpoints including local HTTP providers. The fixed RSS endpoint is rss.qiaomu.ai. The key listener does not upload keystrokes or browsing trails. Broad access enables these page features without asking users to add every site separately. |

Commands are declared in the Manifest commands object, not the permissions list. No history, debugger or identity permission is requested. The cookies permission is optional in the store edition; see the updated justification below.

Remote code: No. All extension executable JS, CSS and fonts are included in the uploaded ZIP. AI/RSS responses are content/data, not executed JavaScript. Original article images/media may be requested from their origins. The Python Native Messaging helper is separate local software invoked only after user installation.

Data usage (conservative draft; confirm against the dashboard's definitions):
- Website content: page text/HTML, images/metadata, selections, drafts and AI conversations. Used for clipping, optional AI and optional public RSS sharing.
- Web history: the current article URL/title and local saved article/chat references; no continuous browsing history collection or history API.
- User activity: not declared as collected; shortcut sequences are inspected locally but no click, scroll or raw keystroke activity log is stored/uploaded.
- Authentication information: user-entered API credentials for their selected AI provider, stored in extension settings and used only with that endpoint. Some settings sync via Chrome; no sale or unrelated transfer.
- Personally identifiable information: anonymous generated RSS client ID and normal network IP metadata at the RSS service; not used for advertising or profiling. No name/contact form is required by the extension itself.
- Personal communications: AI questions/conversation context sent to the user-selected AI provider.
- Location: ordinary server connection IP metadata; no GPS/geolocation API.
- No feature intentionally collects health, financial/credit, personal communications outside the selected page/AI chat, or precise location. Selected website content can itself contain sensitive information: users must not enable public sharing for private content.

Certification statements, after publisher review: no sale of user data; no use/transfer unrelated to the extension's stated functionality; no use/transfer to determine creditworthiness or lending eligibility. Public RSS publication is an explicitly disclosed feature controlled by the sharing option. These declarations must not be changed to “no data collected” merely because some data remains local.

## Reviewer test instructions (English)

Optional account sign-in is not required to test clipping or AI with an API-key provider; ChatGPT/Codex/TokenDance account flows have not been verified with real accounts.
No Qiaomu account is needed for basic clipping, reading, editing, copy or download. No AI account or helper is required to verify the basic workflow.
1. Install the uploaded package and open a public article, e.g. https://developer.chrome.com/docs/webstore/publish .
2. Click the extension toolbar icon. Turn OFF Share to Qiaomu RSS for tests that should stay local.
3. Use Read to view the current draft, and Edit to modify its title/properties/Markdown. Switch back and verify the edits persist. Copy or download Markdown and confirm the draft contents.
4. With Obsidian installed and a local vault open, configure/select a vault and relative folder, then click Clip to Obsidian. Without the helper, the standard Obsidian URI workflow opens Obsidian. Chrome may ask to open the external application.
5. Optional helper test: follow native/README.md in the public repository. Install the helper with YOUR installed extension ID, not the developer's unpacked ID, then choose a vault/folder in Settings and save. macOS/Linux Chrome is verified; Windows installation support awaits device validation. Update the helper from the 1.14.1 source when upgrading from store version 1.7.1.
6. Optional AI test: use YOUR configured provider/model/API key in AI settings. Open an article's AI panel and ask a question. The package does not include credentials or free credits. Check error recovery with no model configured; choose a plain template to save without AI.
7. Optional RSS test: choose only a public article, enable Share to Qiaomu RSS and clip. This sends the URL/title/Markdown/image to https://rss.qiaomu.ai/api/clipper/clips and publishes to https://rss.qiaomu.ai/feeds/user-submitted.xml . This is a real public side effect, so skip if your review should not publish test content.
8. Optional triple-key test: on a public page outside an input, press A three times to read, E three times to edit. Q triggers a real save using the default template and sharing choice; disable RSS before testing it. Shortcuts can be disabled per site.

## Remaining publisher steps

- Verify contact email, account registration, 2-Step Verification and any dashboard requirements; any fee/contract is handled by the publisher.
- Upload package, icon, one or more verified screenshots and the 440×280 promotional image.
- Fill listings, privacy, reviewer instructions and distribution, then save a draft.
- Recheck fresh installation and upgrade using the exact uploaded ZIP; runtime screenshots must show that build and no credentials/private article.
- Confirm the RSS disclosure is clear before first public share. RSS is off by default; confirm it stays off for private tests.
- Only mark “submitted” when the dashboard confirms review submission. README stays “not yet available” until the public listing is visible.

References checked 2026-10-02:
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/extensions/reference/api/commands

## 已保存的后台草稿（2026-10-02）

- 商店 ID：`jniolfihillilkoajpnonlbkhfkiicoo`
- 发布者：vista8；历史后台状态：草稿；首版 1.7.1 已于 2026-10-06 确认公开上架。
- 中文和英文介绍、单一用途、权限理由、隐私政策、审核说明已填写；三项发布者承诺已获用户授权。
- 分发草稿：免费、公开、所有地区。类别：工作流程与规划。
- 图片：`screenshot-clipping.jpg`（1280×800）为当前 popup.html 和生产 CSS 渲染的界面示例，未执行扩展业务脚本，不构成实际安装验收证据。`promo-440x280.jpg` 为品牌宣传图。
- Native Messaging 安装时使用商店 ID；旧开发版 ID 不适用于商店版本。
- 最终提交前仍须以准确上传包完成干净安装验收并补充真实运行截图。

补充验收：生产构建所在的已安装开发版实测提取公开 Chrome 发布文档、复制 Markdown、编辑标题并切换至阅读模式，标题保留成功；RSS 在测试草稿中关闭，没有触发公开投稿。此项不替代商店安装包的全新安装验收。

## 1.14.1 更新检查（2026-10-06）

- GitHub 发布： https://github.com/joeseesun/qiaomu-clipper/releases/tag/1.14.1 。
- 上传使用该发布原始 Chrome ZIP，SHA256：`8e01c0663f5d1c3a8d3f59b4da2c9d459c7d333ceeb26df3f67e22c4818e9118`，11,373,914 字节，118 个文件。
- ZIP 根目录 manifest.json 为 1.14.1，包含 MIT LICENSE.txt，不含助手、测试、source map 或本地凭证文件。权限及 host permissions 与商店首版相同。
- 当前主分支验证：706 项前端测试、130 项助手测试、TypeScript 检查、Chrome 生产构建通过；GitHub CI 37452729885 成功。
- 同步公开隐私页中的本机/云端字幕生成、音频/字幕缓存、浏览器登录状态重试、可选账号授权与凭证同步说明；修正英文 RSS 默认值。
- 从首版升级需要另行更新本地助手，商店更新不会安装或更新助手。
- 尚未验证：真实账号登录、Windows 真机、全部媒体站点的真实重载与播放，以及准确上传包的全新安装和升级流程；不能将自动化通过视为这些场景通过。
- 后台上传及提交状态以实际界面结果记录，公开商店更新需等待审核。

## 后台提交结果（2026-10-06）

- 已上传 1.14.1 到既有商店 ID `jniolfihillilkoajpnonlbkhfkiicoo`，未创建新条目。
- 中英文商品说明、单一用途及 nativeMessaging/storage/host 权限理由已保存；六类原有数据披露和三项承诺保留，公开、免费、所有地区分发配置保持不变。
- 审核说明已更新至 489 字符，包含无账号基础测试、RSS 默认关闭、视频学习、笔记、助手与 AI 前提及详细测试文档链接。
- Google 后台显示「已将您的扩展程序提交送审」，状态页随后显示「状态：待审核」「该草稿尚待审核」。
- 选择正常审核，未申请 declarativeNetRequest 规则变更免审；「通过审核后自动发布」已勾选。
- 首版 1.7.1 仍为公开商店版本；1.14.1 尚未审核通过或公开上线。
- 公开隐私页已经部署并在线验证；资料提交 f1d33a9 的 Chrome CI 37453353238 和 Pages 部署均成功。
- 后台状态截图与原文存于本机 `builds/store-upload/submitted-status.png` / `submitted-status.txt`，不提交包含账号的后台截图到公开仓库。

## 撤回送审与模型修复（2026-10-06）

- 用户要求核查全部开发及模型添加问题，并明确要求测试通过后再送审。已在后台取消 1.14.1 审核，界面确认「状态：已发布 - 公开发布」；公开版本仍为 1.7.1。上述待审核记录为历史状态。
- 1.14.2 修复关闭解释器后配置按钮被禁用、远程预设阻塞初始化、保存失败污染列表、重复提交与服务商切换问题；大模型列表和账号凭证分块保存以避免单个同步项目的容量限制。
- 自动化检查与真实运行验收分开记录。浏览器工具安全策略禁止访问 chrome-extension:// 设置页；不得通过其他浏览器或 UI 工具绕过。真实安装、升级、模型添加保存重载、AI 调用及媒体学习仍需人工验收，未确认前不得重新送审。
- 旧版扩展无法读取超过单项容量后采用的新分块格式；升级兼容旧格式，降级需先减少配置到旧格式容量范围。

- 1.14.2 修复已通过 PR #42 合入 main `3887b8a`；GitHub CI 37455609905 成功，CI Chrome ZIP 的全部文件与本地产物逐字节一致。721 项前端、130 项助手测试，类型检查与三个浏览器构建通过。GitHub 预览发布：https://github.com/joeseesun/qiaomu-clipper/releases/tag/1.14.2 。尚未上传或重新送审。

## 1.14.2 正式提交结果（2026-10-06）

- 用户在知悉真实运行尚未验收后明确指示「先把这些提交一版到应用商店吧」，授权先行提交；此前人工验收门槛未被宣称完成。
- 已上传与 GitHub 发布和 CI 内容一致的 1.14.2 Chrome ZIP，SHA256 `363e2db0f6e7b6fb85d41ac209e6b942c774574c29886477d9a00483fc9ac433`，11,332,280 字节，74 个文件。
- 后台文件包草稿确认为 1.14.2，既有已发布版本为 1.7.1；现有商品资料和披露沿用已保存内容。
- 正常审核，跳过 declarativeNetRequest 安全规则审核选项未勾选；通过审核后自动发布已勾选。
- Google 显示「已将您的扩展程序提交送审」，状态页确认「待审核」「该草稿尚待审核」。官方公开更新仍须等待审核，不等于新版已上架。
- 真实安装/升级、实际 AI 账号调用及媒体站点验收仍未完成；包检查记录保留 false。
- 后台状态原文仅保存在本机 builds/store-upload/submitted-1.14.2-status.txt，不提交账号信息。

## 1.15.2 可选 Cookie 权限说明（2026-10-08）

Optional cookies permission justification:
When the user enables browser-login support and approves the optional permission, read cookies related to the requested media site (YouTube also uses Google login cookies) and pass them only to the separately installed local Native Messaging helper. The helper uses a temporary cookie file to authenticate the user-requested audio download with the original platform for subtitle generation, then deletes it on completion, failure or cancellation. Cookies are not sent to RSS, AI or cloud recognition providers, or used for advertising. Users can disable automatic login use in settings. The store edition does not offer media-file export.

候选上传包：`builds/qiaomu-clipper-1.15.2-chrome.zip`。本节的权限说明不表示已经提交，提交状态以商店后台为准。

## 1.15.3 实际提交记录（2026-10-08）

- 已撤回待审核的 1.15.0，并上传 `qiaomu-clipper-1.15.3-chrome.zip`；后台草稿表确认版本 1.15.3。
- 商店包 SHA-256：`663195c62ba50d316f7e216b74e01ba554f83e9e954cd7406f1abb6e53eb94f6`，与 GitHub release 附件一致。
- 保存可选 cookies 权限理由：用户主动授权后，仅向本机助手传递所请求媒体网站的登录信息；YouTube 同时需要 Google 登录 cookies。临时文件于任务成功、失败或取消后删除。
- 公开中英文隐私政策已更新；后台身份验证信息披露和三项承诺已保持勾选。461 字符测试说明包含无账号基础测试、RSS 默认关闭、助手/ASR 前提和可选授权路径。
- 正常审核，未申请 declarativeNetRequest 安全静态规则免审；通过后自动发布已勾选。
- Google 显示「已将您的扩展程序提交送审」，状态页确认「状态：待审核」「该草稿尚待审核」。公开商店仍为 1.7.1，尚未确认新版上架。
- 1.15.3 修复了版本脚本误改依赖锁造成的干净安装失败。干净 npm ci、802 项前端测试、类型检查、134 项助手测试、各浏览器构建与 edition 检查通过，PR #49 CI 全绿。
- 真实 YouTube 页面执行字幕获取源码返回 723 段、8 条轨道；这不是已安装扩展的端到端验收。真实 Chrome 可选授权弹窗及带登录状态的 ASR 全流程未验证。
- 助手与 1.15.2 相同，复用已签名公证安装包。后台原文保留于本机忽略目录 `builds/store-upload/submitted-1.15.3-status.txt`，不提交账号信息。
