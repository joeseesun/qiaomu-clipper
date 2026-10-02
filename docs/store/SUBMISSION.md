# 乔木剪藏 Chrome Web Store 提交资料

资料日期：2026-10-02。以下内容按当前源代码与 Google 官方文档准备；资料齐备、后台草稿、提交审核和正式上架是不同状态。账号、联系方式、分发范围及后台认证以实际发布者配置为准。

## 文件与链接

- 上传包：`builds/qiaomu-clipper-1.7.1-chrome.zip`（构建后检查 ZIP 根目录 manifest.json）
- 项目主页：https://github.com/joeseesun/qiaomu-clipper
- 支持地址：https://github.com/joeseesun/qiaomu-clipper/issues
- 隐私政策：https://github.com/joeseesun/qiaomu-clipper/blob/main/PRIVACY.md
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
• 可选公开分享：勾选“分享到乔木 RSS”后，剪藏会公开提交链接、标题、正文和封面。

使用前请了解：
1. 保存到 Obsidian 需要你安装 Obsidian；也可只复制/下载 Markdown。
2. 不打开 Obsidian 的静默保存需要另装本地 Native Messaging 助手，当前支持 macOS/Linux Chrome，Windows 暂不支持助手。商店安装不会自动安装该助手。
3. AI 功能需要你自行配置服务商、模型及凭证，费用按服务商规则计算。文章内容、提示词和对话会发送给你选择的服务商。
4. “分享到乔木 RSS”当前默认勾选。开启后内容会公开发布，请在剪藏私人页面前关闭；阅读和编辑本身不会提交 RSS。
5. 本项目基于 Obsidian Web Clipper 独立开发，保留 MIT 许可；不是 Obsidian 官方扩展，也不代表 Obsidian 官方。

支持与反馈：https://github.com/joeseesun/qiaomu-clipper/issues
隐私政策：https://github.com/joeseesun/qiaomu-clipper/blob/main/PRIVACY.md

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
• Optional public sharing to Qiaomu RSS.

Requirements and privacy:
Obsidian must be installed for the Obsidian save workflow; Markdown copy/download works without it. Silent saving requires a separately installed Native Messaging helper for macOS/Linux Chrome. The helper is not bundled with the store installation; Windows helper support is not available.
AI features require your own provider/model and credentials. Content, prompts and conversation context are sent to your configured provider, whose fees and terms apply.
Share to Qiaomu RSS is currently enabled by default. Clipping with it enabled publicly submits the URL, title, Markdown and optional cover image. Turn it off before clipping private content. Reading/editing alone does not submit RSS content.
This is an independent project based on Obsidian Web Clipper under MIT, not an official Obsidian extension.

Support: https://github.com/joeseesun/qiaomu-clipper/issues
Privacy: https://github.com/joeseesun/qiaomu-clipper/blob/main/PRIVACY.md

## Privacy practices — copy-ready English fields

Single purpose:
Help users capture and work with web articles as Obsidian Markdown notes: extract the page, preview/read/edit the draft, optionally ask their configured AI provider about it, then save locally or explicitly share the clip to a public RSS feed.

| Permission | Justification |
|---|---|
| activeTab | Identify and access the page the user chooses to clip via the toolbar, context menu or shortcut. |
| scripting | Inject the bundled extraction, highlighting, reading and clipping scripts into the selected page. No remotely hosted code is injected. |
| storage | Store templates, settings, local chat history, clip drafts, pending retries and the anonymous RSS client ID. Some preferences/templates use Chrome sync storage. |
| clipboardWrite | Copy Markdown/property values at the user's request and support the Obsidian URI fallback save workflow. |
| nativeMessaging | Communicate with the optional, separately installed local helper to choose a vault/folder and save Markdown inside that vault. No helper is installed automatically. |
| contextMenus | Provide user-invoked clipping and highlighting actions from the page context menu. |
| sidePanel | Display the clipping interface in Chrome's side panel when requested. |
| declarativeNetRequest | Apply bundled, narrowly filtered YouTube embed and youtubei header rules required by the inherited article-reader/video functionality. Not used to block advertising or track traffic. |
| http://*/* and https://*/* | Support clipping and reading arbitrary websites, the persistent configurable triple-press shortcut listener/content loader, and requests to user-configured AI endpoints including local HTTP providers. The fixed RSS endpoint is rss.qiaomu.ai. The key listener does not upload keystrokes or browsing trails. Broad access enables these page features without asking users to add every site separately. |

Commands are declared in the Manifest commands object, not the permissions list. No history, cookies, debugger or identity permission is requested.

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

No Qiaomu account is needed for basic clipping, reading, editing, copy or download. No AI account or helper is required to verify the basic workflow.
1. Install the uploaded package and open a public article, e.g. https://developer.chrome.com/docs/extensions/overview .
2. Click the extension toolbar icon. Turn OFF Share to Qiaomu RSS for tests that should stay local.
3. Use Read to view the current draft, and Edit to modify its title/properties/Markdown. Switch back and verify the edits persist. Copy or download Markdown and confirm the draft contents.
4. With Obsidian installed and a local vault open, configure/select a vault and relative folder, then click Clip to Obsidian. Without the helper, the standard Obsidian URI workflow opens Obsidian. Chrome may ask to open the external application.
5. Optional helper test: follow native/README.md in the public repository. Install the helper with YOUR installed extension ID, not the developer's unpacked ID, then choose a vault/folder in Settings and save. Current helper support is macOS/Linux Chrome only.
6. Optional AI test: use YOUR configured provider/model/API key in AI settings. Open an article's AI panel and ask a question. The package does not include credentials or free credits. Check error recovery with no model configured; choose a plain template to save without AI.
7. Optional RSS test: choose only a public article, enable Share to Qiaomu RSS and clip. This sends the URL/title/Markdown/image to https://rss.qiaomu.ai/api/clipper/clips and publishes to https://rss.qiaomu.ai/feeds/user-submitted.xml . This is a real public side effect, so skip if your review should not publish test content.
8. Optional triple-key test: on a public page outside an input, press A three times to read, E three times to edit. Q triggers a real save using the default template and sharing choice; disable RSS before testing it. Shortcuts can be disabled per site.

## Remaining publisher steps

- Verify contact email, account registration, 2-Step Verification and any dashboard requirements; any fee/contract is handled by the publisher.
- Upload package, icon, one or more verified screenshots and the 440×280 promotional image.
- Fill listings, privacy, reviewer instructions and distribution, then save a draft.
- Recheck fresh installation and upgrade using the exact uploaded ZIP; runtime screenshots must show that build and no credentials/private article.
- Confirm the RSS disclosure is clear before first public share. The current default-on sharing is explicitly disclosed, but needs careful fresh-user review before final submission.
- Only mark “submitted” when the dashboard confirms review submission. README stays “not yet available” until the public listing is visible.

References checked 2026-10-02:
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/extensions/reference/api/commands

## 已保存的后台草稿（2026-10-02）

- 商店 ID：`jniolfihillilkoajpnonlbkhfkiicoo`
- 发布者：vista8；后台状态：草稿，尚未提交审核/上架。
- 中文和英文介绍、单一用途、权限理由、隐私政策、审核说明已填写；三项发布者承诺已获用户授权。
- 分发草稿：免费、公开、所有地区。类别：工作流程与规划。
- 图片：`screenshot-clipping.jpg`（1280×800）为当前 popup.html 和生产 CSS 渲染的界面示例，未执行扩展业务脚本，不构成实际安装验收证据。`promo-440x280.jpg` 为品牌宣传图。
- Native Messaging 安装时使用商店 ID；旧开发版 ID 不适用于商店版本。
- 最终提交前仍须以准确上传包完成干净安装验收并补充真实运行截图。
