## 中文

### 新增与修复
- AI 对话可读取正文中的实际图片，支持选择单图、长图分段和按图片编号定位；无需先保存笔记。图片只在当前页面内存中缓存，对话历史不保存图片字节。
- 小红书支持提取正文与有序图集、视频学习及字幕生成；修复生成字幕立即出现 `bad-request` 的问题。
- X 列表页不再自动挂载字幕工具条，主动进入学习页仍可读取视频；修复换模型时弹窗重复出现，并提供可用的助手安装入口。
- 本地助手增加 Whisper 近数字静音保护，减少空音频产生的字幕幻觉；这不是人声检测，不能保证过滤纯音乐。
- 统一开发构建、测试入口和发布归档，显示构建来源；交付时检查功能清单，避免不同工作区更新测试包时遗漏已包含的能力。

### 升级
- GitHub 安装请选择 `chrome-local.zip`；`chrome-store.zip` 是 Chrome 商店提交包。更新扩展后刷新原网页并重新打开阅读页，AI 对话应显示图片数量。
- macOS 新安装或需要本次静音保护、小红书视频支持时，使用本发行版配套的 **1.16.2 助手**。固定名 `qiaomu-clipper-helper.pkg` 与带版本号文件相同；助手与扩展独立编号。Windows／Linux 按 `native/README.md` 更新助手源码。
- 图片问答需要当前模型及服务支持图片输入；读取或服务拒绝时会提示，不会静默改成仅文字请求。无需安装助手即可使用图片问答。

### 验证与边界
- 本次集成通过 1,088 项前端测试、9 项构建流程测试和 TypeScript 检查；图片传递覆盖 Chat Completions、Responses、Codex OAuth、Anthropic、Gemini、Ollama 的请求结构。
- 固定测试目录的构建与产物摘要经过核验。源功能开发期间曾通过 DeepSeek 通道实测图片问答；本次发布构建未重复真实模型调用和浏览器全流程，不据此承诺所有模型都能读图。Firefox／Safari 仅完成构建验收。
- 小红书剪藏图片仍可能使用有时效的站点外链，不保证离线保存。本次仅发布 GitHub，不代表 Chrome 商店已更新。

## English

### Added and fixed
- Article chat now sends actual image data, with per-image selection, long-image tiling and numbered references. No note needs to be saved. Image bytes are cached in page memory and excluded from conversation history.
- Added Xiaohongshu article/image extraction, video study and caption generation, including the fix for immediate `bad-request` errors.
- Stopped automatic caption toolbars on X feeds while preserving explicit video study. Model changes keep one dialog, and helper installation actions lead to the relevant download or setup guide.
- Added a conservative near-digital-silence guard for Whisper. This is not voice-activity detection and does not guarantee filtering music.
- Standardized builds, a stable testing location and immutable release archives. Build identity and feature checks help prevent incomplete deliveries across working trees.

### Upgrade
- Use `chrome-local.zip` for GitHub installation; `chrome-store.zip` is the Chrome Web Store submission package. Reload the extension, refresh the source page and reopen the reader to see image counts in chat.
- This release includes the independently versioned **1.16.2 macOS helper** for fresh installations and the new silence/Xiaohongshu support. The fixed-name and versioned PKG are identical. Windows/Linux users should update helper source following `native/README.md`.
- Image chat requires an image-capable model and service, but no local helper. Fetch or provider failures are shown explicitly rather than silently sending text only.

### Verification and limits
- The integrated code passed 1,088 frontend tests, 9 build-workflow tests and TypeScript checks. Automated coverage verifies image request formats for Chat Completions, Responses, Codex OAuth, Anthropic, Gemini and Ollama.
- Fixed-install artifacts were checked against build digests. The feature's earlier development included a live DeepSeek image test; live inference and the full installed-browser workflow were not repeated on this release build. Firefox/Safari have build coverage only.
- Xiaohongshu image links may expire and are not guaranteed offline. This GitHub release does not publish an extension-store update.
