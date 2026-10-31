## 中文

### 新增与修复
- 阅读、视频学习和写作连接起来：从素材直接开始文章，统一模型选择、思考强度、引用预览和选段编辑。
- AI 对话支持联网搜索与来源阅读、找图和后台生图；独立图库管理生成图片、上传图片、授权文件夹与 Unsplash 图片，并可插入文章。
- 增加即梦服务和本机 Codex 生图接入。修复 Codex 已生成图片却因保存路径校验无法接收的问题。
- 完整卸载助手及移除识别引擎时保留共享模型缓存；旧助手缺少安全卸载能力时提示更新。修复 Linux 卸载测试并补充三平台回归。
- 重写中英文商店介绍，更新五张功能截图、两张宣传图和隐私说明。商店图标继续使用真实产品 Logo。

### 验证与未验证
- 1,620 项前端测试、TypeScript、110 项翻译检查和 60 项商店下载策略通过。助手全量回归及三平台 CI 见本版发布记录。
- 真实搜索返回 6 条来源，网页读取返回正文；真实 Codex 生图完成，助手成功分三块读取 1,063,638 字节 PNG。
- 固定测试入口的 Chrome 实际重载、所有供应商逐一出图、关闭实际侧栏后恢复、Windows/Intel 真机识别及平台草稿写入未在本轮验证。Firefox 和 Safari 以构建验证为限；宣传截图中的内容与 AI 回复为明示示例。
- GitHub 发布、商店提交、审核通过和公开安装分别记录。

### 升级
更新后刷新网页并重新打开阅读或写作页面。本机 Codex 与安全卸载需要本版助手 **1.16.9**；请从设置下载安装。文章和设置保留。商店版仍不提供 YouTube 媒体文件下载。

## English

### Added and fixed
- Connect reading, video study and writing: start articles from source material, with shared model selection, reasoning controls, reference previews and selection editing.
- Search the web and read sources in AI chat, find photos and generate images in the background. Manage generated images, uploads, authorized local folders and Unsplash photos in a separate library.
- Add Jimeng and local Codex image integrations. Fix completed Codex images being rejected because the CLI also supplied a global artifact path.
- Preserve shared model caches when uninstalling the helper or a speech engine. Require a safe helper version for full uninstall; fix Linux fixtures and add cross-platform uninstall regression coverage.
- Refresh English and Chinese listings, five screenshots, two promotional images and privacy disclosures. Keep the actual product logo as the store icon.

### Verification and limitations
- 1,620 frontend tests, TypeScript, 110 translation checks and 60 store download-policy tests pass. See the release record for the complete helper suite and cross-platform CI.
- Live search returned six sources and Fetch returned page content. Live Codex generation produced a PNG of 1,063,638 bytes, successfully read through three native-message chunks.
- Installed Chrome reload, every image provider, recovery after closing the actual sidebar, Windows/Intel speech recognition and platform draft submission were not verified in this run. Firefox and Safari have build verification only. Marketing screenshots explicitly use sample content and AI responses.
- GitHub publication, store submission, approval and public availability are separate states.

### Upgrade
Refresh pages and reopen reading or writing views after updating. Install helper **1.16.9** from settings for local Codex and safe uninstall. Articles and settings are retained. The store edition continues to exclude YouTube media-file downloads.
