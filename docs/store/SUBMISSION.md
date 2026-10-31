# 乔木剪藏 Chrome Web Store 提交资料

资料日期：2026-10-21。以下内容按当前源代码与 Google 官方文档准备；资料齐备、后台草稿、提交审核和正式上架是不同状态。账号、联系方式、分发范围及后台认证以实际发布者配置为准。

## 文件与链接

- 本版上传包：1.19.0，由干净提交执行 `npm run package -- --release` 生成。助手单独发布 1.16.9，不能复用旧助手资产。
- 本轮素材、规格和证据：[2026-10 商店改版](2026-10-refresh/README.md)。
- 初始状态：公开商店 1.18.8；GitHub Release 1.18.9。1.19.0 基于集成 PR #95 / `37cc07a3`，叠加安全卸载与真实生图修复。最终状态见对应 Release/后台。
- 项目主页：https://github.com/joeseesun/qiaomu-clipper
- 支持地址：https://github.com/joeseesun/qiaomu-clipper/issues
- 隐私政策：https://joeseesun.github.io/qiaomu-clipper/privacy.html
- 单一目的、权限和数据申报：见下文，需与后台实际字段及上传 Manifest 一致。
- 类别建议：Productivity（以后台实际可用分类为准）；费用：扩展免费，用户自己的 AI 服务可能收费。
- 开发者联系邮箱：由发布者提供/后台验证，不能用猜测的地址。
- 名称：乔木剪藏 · Obsidian + RSS（匹配 Manifest）

## 中文商店介绍

名称
乔木剪藏 · Obsidian + RSS

短介绍
把看过的，变成自己的。网页剪藏、双语视频学习、随页 AI 问答、Markdown 写作与配图，在浏览器里连起来。

详细介绍
读到一篇好文章、看完一段视频，然后呢？

乔木剪藏把阅读、学习和创作放进同一个浏览器工作流：留下值得记住的内容，问清没看懂的地方，再写成自己的笔记或文章。

不用先配置 AI。安装后，就能开始阅读、剪藏和编辑。

看懂一页，留下重点
去掉页面干扰，调整字体、行距与配色；划线标记，保留来源，把网页和选中文字整理成干净的 Markdown。代码缩进、表格与公式有各自的呈现方式。可以保存到 Obsidian，也可以直接复制或下载文件。

让长视频成为可以翻阅的文字
在支持的视频和播客页面，把播放器与文字稿放在一起。搜索一句话，点击时间戳回到那一刻；原文、译文、双语按需切换。调整字幕位置、样式和播放速度，边看边记。字幕可导出为 Markdown、SRT、VTT 或 TXT；没有可用字幕时，可选择本机或自己配置的云端语音服务生成。

问题，就在原网页旁边问
打开 AI 侧栏，针对当前页面或选中的一段话追问。支持图片输入的模型还可以看正文图片、指定单图和长图分段。对话按页面保存；配置搜索服务后，可以开启联网搜索并查看来源。模型选择、最近使用和可用的思考强度集中在同一处。

从一份素材，开始一篇文章
在阅读或学习页选择“写文章”，带入来源内容；视频素材可带入视频、简介与已取得的字幕。所见即所得的 Markdown 编辑器支持大纲、表格、代码、公式、流程图和图片。让 AI 帮你梳理结构、润色选段、续写或起标题，检查后再将结果放进正文。文章自动保存在本机，可导入、导出和继续编辑。

找图、生成、收好，再用进文章
连接图片服务后，在对话里描述需要的配图，或搜索现成图片。生图任务在后台继续，关闭侧栏后可返回查看结果。图库集中管理生成图片、上传图片、授权的本地图片文件夹与 Unsplash 搜索结果；预览、下载、插入文章各自独立。

把成果带走
笔记保存到 Obsidian，文章导出为 Markdown 或带图片的 ZIP。需要分发时，可将文章送到 X 文章草稿；搭配乔木 Publish，可交接到支持的平台编辑器，由你检查后手动发布。可选的乔木 RSS 公开分享默认关闭。

顺手的小功能，也已经准备好
• 连按三次 A 阅读、E 编辑、Q 剪藏、I 记笔记、U 写文章；按键可调整或按网站关闭。
• 模板管理保存目录、属性和正文格式。
• 阅读、学习与写作使用统一的操作入口。
• 完整界面翻译覆盖简体中文、繁体中文、英语、日语、韩语、西班牙语、法语、德语与巴西葡萄牙语。

使用与数据说明
• 扩展免费。AI 问答、翻译、生图和联网搜索需连接你自己的服务或受支持账号，可能产生服务商费用；扩展不包含免费模型额度。
• AI 请求会将所需的文章、选区、图片、问题或对话上下文发送给你选择的服务；联网搜索和图片搜索会向相应服务发送查询，读取来源页会请求该网站。
• 文章与图库保存在本机浏览器，不会自动上传到乔木服务器。部分设置和模板可随浏览器同步。卸载或清除扩展数据前，请导出需要保留的内容。
• 保存到 Obsidian 需安装 Obsidian。静默保存、部分字幕生成及本机 Codex 生图需另装本地助手；本机 Codex 还需已登录的 Codex CLI。商店安装不会自动安装它们。只有选择云端语音服务时，相关音频才发送给该服务。
• 视频字幕、媒体读取和平台草稿功能取决于网站、登录状态、账号权限及地区；不能保证每个网页都可用。商店版不提供 YouTube 媒体文件下载。
• 乔木 RSS 分享默认关闭；开启并提交后，所选链接、标题、正文和封面会公开。发到平台的内容由该平台处理，最终发布由你操作。
• 本项目基于 Obsidian Web Clipper 独立开发，保留 MIT 许可，不是 Obsidian 官方扩展。

支持与反馈：https://github.com/joeseesun/qiaomu-clipper/issues
隐私政策：https://joeseesun.github.io/qiaomu-clipper/privacy.html

## English store listing

Name
乔木剪藏 · Obsidian + RSS

Short description
Turn what you read and watch into notes and articles. Clip pages, study captions, ask AI, write Markdown and add images.

Detailed description
Read something worth keeping? Watch something worth learning?

Qiaomu Clipper connects reading, video study and writing in your browser. Keep the useful parts, ask about what you don't understand, and turn your source material into notes or an article of your own.

Start reading, clipping and editing without configuring AI.

READ WITH FOCUS
Open a clean reading view, adjust typography and colors, and highlight passages. Keep the source link and turn pages or selections into Markdown. Save to Obsidian, or simply copy and download your notes.

READ YOUR VIDEOS, TOO
On supported video and podcast pages, keep the player and transcript together. Search a phrase and jump to its timestamp. Switch between original, translated and bilingual text, adjust captions, and take learning notes. Export transcripts as Markdown, SRT, VTT or TXT. When captions are unavailable, choose an on-device engine or your configured cloud speech service.

ASK QUESTIONS BESIDE THE PAGE
Open an AI sidebar for the current page or a selected passage. Models that accept images can also answer questions about article images, selected images and sections of a long image. Conversations are saved by page. Connect a search service to search the web and inspect sources. A shared model picker keeps recent models and supported reasoning settings within reach.

TURN SOURCE MATERIAL INTO YOUR NEXT DRAFT
Choose Write article from a reading or study page. Bring in the source, including a video, its description and available transcript. The visual Markdown editor supports outlines, tables, code, formulas, diagrams and images. Ask AI to develop a structure, edit a passage, continue a draft or suggest a title. Review changes before adding them to the document. Articles autosave locally and can be imported or exported.

FIND AN IMAGE. MAKE AN IMAGE. KEEP IT HANDY.
Connect an image service, describe an illustration in chat, or search for an existing photo. Image jobs can continue after the sidebar closes. Your image library brings together generated images, uploads, authorized local folders and Unsplash search. Preview, download and insert images as separate actions.

TAKE YOUR WORK WITH YOU
Save notes to Obsidian and export articles as Markdown or ZIP files with images. Send an article to an X Article draft, or use the Qiaomu Publish integration to hand content to supported platform editors. Review and publish it yourself. Optional public sharing to Qiaomu RSS is off by default.

SMALL DETAILS THAT MAKE IT EASIER
• Configurable triple-press shortcuts for reading, editing, clipping, quick notes and writing, with per-site controls.
• Templates for note folders, properties and content.
• Shared reading and study actions.
• Complete interface translations in Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Spanish, French, German and Brazilian Portuguese.

REQUIREMENTS AND DATA
The extension is free. AI chat, translation, image generation and web search require your own service or supported account; provider charges may apply. No free model credits are included.

AI requests send the required content, selections, images, questions and conversation context to the provider you choose. Web and image search send queries to the selected service; opening source content requests that website.

Articles and library images stay in local browser storage and are not automatically uploaded to Qiaomu servers. Some settings and templates can sync through the browser. Export important content before uninstalling or clearing extension data.

Obsidian must be installed for Obsidian saving. Silent saving, some subtitle workflows and local Codex image generation need a separately installed helper. Local Codex also needs a signed-in Codex CLI. These are not installed with the store extension. Audio is sent to a cloud speech service only when you select that service.

Caption access, media access and platform drafts depend on the website, sign-in state, account access and region. Not every page is supported. The store edition does not download YouTube media files.

Qiaomu RSS sharing is off by default. Enabling it and submitting a clip makes the selected URL, title, text and cover public. Content sent to a publishing platform is handled by that platform; final publication remains your action.

This independent MIT-licensed project is based on Obsidian Web Clipper. It is not an official Obsidian extension.

Support: https://github.com/joeseesun/qiaomu-clipper/issues
Privacy: https://joeseesun.github.io/qiaomu-clipper/privacy.html

## Privacy practices — copy-ready English fields

Single purpose:
Help users turn web reading and audio/video transcripts into reusable notes and articles: read, study, ask their selected AI services, draft and illustrate the result, then save or explicitly hand off the finished content. Clipping, captions, AI chat, writing and the image library support this one content-to-notes-and-articles workflow.

| Permission | Justification |
|---|---|
| downloads (optional) | Requested only on a Download click to save a supported study-page media file to the local Downloads folder, monitor that download and reveal its file. Does not inspect unrelated download history. YouTube media-file downloads are blocked. |
| activeTab | Identify and access the page the user chooses to clip via the toolbar, context menu or shortcut. |
| scripting | Inject the bundled extraction, highlighting, reading and clipping scripts into the selected page. No remotely hosted code is injected. |
| offscreen | Keep user-requested image generation, Blob decoding and local image storage running when a popup or sidebar closes. The bundled offscreen document uses runtime messaging; it does not execute remote code or track browsing. |
| unlimitedStorage | Preserve local articles, transcript caches and image-library data without the small default extension-storage quota. This permission does not upload content or provide access to unrelated files. |
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

Optional account sign-in is not required to test clipping or AI with an API-key provider. Local Codex image generation was verified with a signed-in Codex CLI and helper 1.16.9; other account-based image providers have not all been verified with real accounts.
No Qiaomu account is needed for basic clipping, reading, editing, copy or download. No AI account or helper is required to verify the basic workflow.
1. Install the uploaded package and open a public article, e.g. https://developer.chrome.com/docs/webstore/publish .
2. Click the extension toolbar icon. Turn OFF Share to Qiaomu RSS for tests that should stay local.
3. Use Read to view the current draft, and Edit to modify its title/properties/Markdown. Switch back and verify the edits persist. Copy or download Markdown and confirm the draft contents.
4. With Obsidian installed and a local vault open, configure/select a vault and relative folder, then click Clip to Obsidian. Without the helper, the standard Obsidian URI workflow opens Obsidian. Chrome may ask to open the external application.
5. Optional helper test: use helper 1.16.9 and follow native/README.md in the public repository. Install the helper with YOUR installed extension ID, not the developer's unpacked ID, then choose a vault/folder in Settings and save. The signed, notarized macOS package and isolated native-message self-test were verified; this release's system upgrade and Windows installation still require device validation.
6. Optional AI test: use YOUR configured provider/model/API key in AI settings. Open an article's AI panel and ask a question. The package does not include credentials or free credits. Check error recovery with no model configured; choose a plain template to save without AI.
7. Optional RSS test: choose only a public article, enable Share to Qiaomu RSS and clip. This sends the URL/title/Markdown/image to https://rss.qiaomu.ai/api/clipper/clips and publishes to https://rss.qiaomu.ai/feeds/user-submitted.xml . This is a real public side effect, so skip if your review should not publish test content.
8. Optional triple-key test: on a public page outside an input, press A three times to read, E three times to edit. Q triggers a real save using the default template and sharing choice; disable RSS before testing it. Shortcuts can be disabled per site.

## Remaining publisher steps

- Verify contact email, account registration, 2-Step Verification and any dashboard requirements; any fee/contract is handled by the publisher.
- Upload package, icon, one or more verified screenshots and the 440×280 promotional image.
- Fill listings, privacy, reviewer instructions and distribution, then save a draft.
- Recheck fresh installation and upgrade using the exact uploaded ZIP; runtime screenshots must show that build and no credentials/private article.
- Confirm the RSS disclosure is clear before first public share. RSS is off by default; confirm it stays off for private tests.
- Only mark “submitted” when the dashboard confirms review submission. A public listing already exists; verify its displayed version independently of the pending package.

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


## 1.15.6 实际提交记录（2026-10-08）

- 已撤回待审核的 1.15.3；上传 `qiaomu-clipper-1.15.6-chrome.zip`，后台软件包表确认草稿版本为 1.15.6。
- 正常提交审核，没有选择仅 DNR 安全规则变更的免审选项；勾选通过审核后自动发布。
- 后台显示「已将您的扩展程序提交送审」，状态页确认「该草稿尚待审核」。当时已发布版本仍为 1.7.1，不能视为 1.15.6 已上架。
- 477 字符的英文审核说明已保存并重新读取确认以 1.15.6 开头：文章阅读／编辑／复制／Markdown 导出不需登录，RSS 默认关闭且提交公开；原始 YouTube 字幕优先；生成字幕依赖独立助手与本机模型或用户配置的云端服务；cookies 为可选权限、只交给本机助手并删除临时文件；商店版没有媒体导出。
- PR #53 已合并，823 项前端测试、类型检查、四个浏览器构建与商店／本地版检查通过。CI 全绿（包含助手测试）。GitHub Release 的 5 个文件 SHA256 与本地产物全部一致。
- 真实 Ego Lite 扩展运行版本确认 1.15.6，AI 无模型提示、设置跳转、无双重边框和 1px 键盘焦点线已验证；ASR 设置能读取现有助手和已安装模型。真实可选 cookies 授权及完整 YouTube ASR 仍未验收。
- 助手二进制未改动，复用既有签名公证安装包。状态页证据在本机忽略目录 `builds/store-upload/submitted-1.15.6-status.txt`，不提交账号信息。

## 1.15.8 实际提交记录（2026-10-08）

- 用户改为要求立即重新提审；已撤回待审核的 1.15.6，上传 GitHub 已公开发布的 `qiaomu-clipper-1.15.8-chrome.zip`。后台软件包表确认草稿版本 1.15.8，已发布版本仍为 1.7.1。
- 上传包 SHA-256：`36065c7dc4e09fe07c696f40a018545d236ce5c3278e4dfde28ec9bd19668611`。清单版本为 1.15.8，没有本地版 key；cookies 只声明为可选权限。
- 正常提交审核，未选择 DNR 安全规则免审；勾选通过审核后自动发布。提交后重新打开状态页确认「状态：待审核」「该草稿尚待审核」。新版尚未上架。
- 中英文商品介绍已更新，保存后重新读取核对：九种完整界面语言、原始字幕优先、本机或用户配置的云端 ASR、可选独立助手、RSS 默认关闭及公开分享边界。
- 462 字符的英文审核说明已保存：文章剪藏、阅读、编辑及 Markdown 导出无需登录；生成字幕依赖可选助手和模型或云端服务；当前网站登录数据仅传给本机助手并删除临时文件；商店版无媒体导出按钮。现有隐私和分发设置保持原样。
- 新助手安装包已签名并通过 Apple 公证。本机实际安装 1.15.8，并完成助手连接、Obsidian 库和本机模型自检；真实 YouTube 完整 ASR 尚未验收。
- 状态和软件包原文及截图仅保留在本机忽略目录 `builds/store-upload/submitted-1.15.8-*`，不提交包含账号的后台截图。原延后提审任务已暂停，避免重复提交。

## 1.18.0 媒体下载审核说明

- 本次新增的是学习页完整媒体文件保存。来自 YouTube 页面或 youtube.com、youtu.be、youtube-nocookie.com、googlevideo.com 等媒体来源的文件在商店版禁用；实际 fetch 也执行检查，并禁止自动跟随下载跳转。
- 下载直接由浏览器完成；部分原站媒体地址的提取仍需本地助手。不会在安装助手后解锁商店版 YouTube 下载。
- 不提供 DRM 解密、HLS/DASH 合并、分轨合并、付费墙绕过。现有字幕获取与生成是不同功能；生成字幕可能由助手临时下载音轨，仍在隐私政策中如实披露，不宣称商店版完全不访问音轨。
- `downloads` 是可选权限，拒绝后不发起媒体下载。原有 cookies 可选权限、站点访问和 Native Messaging 功能保留。
- 审核演示使用自有或明确允许下载的媒体。下载完成以浏览器文件状态为准；原有图片问答和小红书提取包含在本版。
- 当前文件只是提交材料，不代表已提交或审核通过；实际提交结果单独记录。


## 1.18.6 提审材料（2026-10-16，尚未提交）

- 上传 `qiaomu-clipper-1.18.6-chrome-store.zip`，独立版包不得上传商店。商店构建剔除 `allowYoutube`；前端、后台及助手默认策略均拒绝 YouTube 文件下载。
- downloads 为可选权限：用户点击下载后才请求，用于保存允许下载的非 YouTube 媒体并显示进度。分轨媒体或回放可由用户另装的本机助手下载合并，不解密 DRM。
- cookies 为可选权限：用户开启登录支持并授权后，仅将当前媒体站点的登录信息交给本机助手向原站验证；临时文件在成功、失败、取消后删除，不发送给 AI、RSS 或开发者。
- unlimitedStorage：保留用户本机的字幕、草稿和学习内容，避免小额度导致保存失败；缓存仍有数量和容量上限，不用于上传或追踪。
- 视频号学习把当前分享链接交给用户登录的腾讯元宝解析，仅读取返回的官方播放页；需登录时由用户完成。隐私页已补充此处理。
- 以上为本版本材料；旧版“商店无媒体导出”及“不合并分轨”的记录仅描述历史版本。

Reviewer instructions (under 500 characters):
1.18.6: Clip/read/edit/export a public article without login; RSS is off by default. Study pages offer original/bilingual captions. Optional subtitle generation needs the separately installed helper and your model/service. Optional downloads save non-YouTube media; the helper can merge split streams. YouTube file download is absent in this store build. Cookies are optional, passed only to the local helper and deleted after use. Channels links use your Tencent Yuanbao login. No DRM decryption.

## 1.18.7 提审材料（2026-10-17）

新包包含小宇宙紧凑吸顶播放条、写长文编辑器及助手、Obsidian 发布桥和取消/图片完整性修复。使用 chrome-store.zip；商店版继续排除 YouTube 文件下载。现有 cookies/downloads 仍为可选权限，无新增权限。

写长文与发布桥的数据处理详见公开隐私页。Website content 包含写作文章、附图与选定发布目标；仅用户主动操作才交给选定 AI 服务或已登录的 X/知乎/小红书平台，不自动点击最终发布。

审核说明（500 字符内）：

1.18.7: Clip/read/edit/export public articles without login. Open Write long articles to create/save/export locally; AI uses your provider. Optional Qiaomu Publish handoff sends selected content via localhost to signed-in X/Zhihu/Xiaohongshu draft editors; no final Publish click. Captions may use a separately installed helper/model. Downloads exclude YouTube. Cookies are optional and passed only to the local helper. Channels resolution uses your Yuanbao login. RSS is off by default. No DRM decryption.

上传及提交结果以后台实际状态为准，此处不代表已经送审。
