# 乔木剪藏隐私说明 / Privacy

更新日期：2026-10-02。适用于乔木剪藏 Chrome 扩展。

剪藏功能读取用户打开的网页、链接、标题、元数据及选中文字，用于提取 Markdown、预览和保存。模板、设置、历史记录、待保存内容及预览草稿存储在浏览器扩展存储中；部分模板和设置通过浏览器同步存储同步。预览草稿最多读取 24 小时，在下次创建预览时清理过期草稿；待重试内容保留到成功或用户清理扩展数据。扩展代码不提供访问统计上传功能。

安装可选本地助手后，扩展通过 Chrome Native Messaging 将笔记内容和相对位置传给本机助手。助手在用户选定的 Obsidian 库内写入 Markdown；库的绝对路径只在本机配置。未安装助手时使用 Obsidian URI 和上游剪贴板保存流程。

勾选“分享到乔木 RSS”（当前默认勾选）并点击剪藏后，链接、标题、剪藏 Markdown 和可选封面地址通过 HTTPS 发送到 `rss.qiaomu.ai`，收录后网站和 RSS 订阅者可以公开读取。请求还包含本地生成的匿名设备编号，用于识别客户端和限流；服务端也可获得正常网络请求的 IP 地址等连接信息。此编号不包含电脑名或笔记库路径。公开提交不会因卸载扩展自动撤回；如需删除已提交内容，请通过维护者联系渠道提出请求，已经被第三方订阅的副本可能无法撤回。

预览本身不上传草稿。取消 RSS 选项后，剪藏不向 RSS 接口提交正文；阅读网页仍可能从原站获取网页和图片。可选 AI 解释器会将所需网页内容、提示词及用户配置的凭证发送到用户选择的服务商端点，适用该服务商的隐私与收费规则。

AI 问题与对话上下文也会发送到用户选择的服务商；用户输入的 API 凭证存储在扩展设置中，可能随浏览器设置同步，仅用于请求对应服务商。

AI 对话的文章地址、标题、问题、所选片段和模型回答保存在本机浏览器存储中，最多保留 40 篇文章、每篇 15 段对话，每段最多 40 条消息。用户可以删除对话记录。三连击快捷键只在本机判断配置的按键序列，输入框内不触发，不上传原始按键记录。

用户数据仅用于用户选择的剪藏、阅读、编辑、问答和分享功能，不出售用户数据，不用于广告投放、信用评估或与这些功能无关的用途。扩展对用户数据的使用遵循 Chrome Web Store User Data Policy，包括 Limited Use 要求。

用户可修改模板、保存位置及 RSS 选项；清理扩展存储或卸载可移除本机扩展数据（会丢失模板和待重试内容）。本地 Markdown、助手配置及已公开提交的内容需要分别处理。隐私问题可通过 [维护者 GitHub](https://github.com/joeseesun) 联系；不要在公开 Issue 中附上私人正文、凭证或完整日志。

## English

The extension reads the active web page, metadata and selected text to extract, preview and save Markdown. Templates, settings, history, pending clips and draft previews are stored in browser extension storage; some settings and templates use browser sync storage. Preview drafts are readable for up to 24 hours and expired drafts are removed when a new preview is created. Pending retries remain until success or local data clearing.

The optional Native Messaging helper receives note content and a relative path to write Markdown inside your selected local Obsidian vault. Absolute vault paths are configured locally. Without the helper, saving uses the inherited Obsidian URI and clipboard flow.

When the RSS checkbox is enabled (currently the default) and you click Clip, the URL, title, clipped Markdown and optional image URL are sent over HTTPS to rss.qiaomu.ai for public publication. Requests include a locally generated anonymous device ID used for client identification and rate limiting; the server can also receive normal network connection metadata such as the IP address. The ID does not include your computer name or vault path. Uninstalling does not retract public submissions; contact the maintainer for removal requests. Third-party RSS copies may persist.

Previewing alone does not submit content. Original sites may receive page and image requests. Optional AI interpretation sends relevant content, prompts and configured credentials to your chosen provider endpoint under its own terms. Clearing extension data removes local extension data, but vault notes, helper configuration and public submissions require separate handling. Contact the maintainer through [GitHub](https://github.com/joeseesun) without posting private content or credentials in public issues.


AI questions and conversation context are also sent to the chosen provider. User-entered API credentials are stored in extension settings, may sync with browser settings, and are used only with the configured provider.

AI chat history (article URL/title, questions, selected passages and model answers) stays in local browser storage, limited to 40 articles, 15 conversations per article and 40 messages per conversation. Users can delete conversations. Triple-press shortcuts inspect configured key sequences locally, ignore typing in editable fields, and do not upload raw keystroke logs. User data is used only for the clipping, reading, editing, AI and sharing features the user chooses; it is not sold or used for advertising, creditworthiness or unrelated purposes. Use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.
