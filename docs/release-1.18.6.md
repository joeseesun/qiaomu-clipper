## 中文

### 新增与修复
- 视频号学习进入商店版和独立版：分享页增加「用乔木剪藏打开」，自动通过腾讯元宝读取，显示登录与读取进度；官方播放页提供字幕条和学习入口。
- 独立版新增 YouTube 视频、音频文件下载，需要本地助手；商店版继续禁用 YouTube 文件下载。
- 助手 1.16.6 优先保存兼容性更好的 MP4，必要时回退 MKV；YouTube 下载先尝试匿名读取，失败后按已有授权使用登录状态。
- 保留此前的双语字幕、字幕样式与快捷键、图片问答、学习笔记、各站媒体下载和本机识别恢复。同步版本选择指南、隐私披露和商店审核材料。

### 验证与未验证
- 干净安装依赖、1,337 项前端测试、225 项助手测试、TypeScript、九语言和商店下载策略检查通过；7 项前端用例按既有条件跳过。
- 视频号分享入口、解析状态、来源身份校验和标签页清理通过自动回归。没有自动操作微信客户端；本版本的真实视频号登录、完整字幕生成和逐站最终文件下载尚未逐项验收。
- Windows 和 Intel Mac 真机尚未验证。YouTube 下载仍受原站登录与格式限制，不支持直播或 DRM。
- GitHub 发布、商店送审与商店公开上线分别确认，不能相互替代。

### 升级
更新扩展后刷新网页并重新打开学习页。需要新下载能力时同时安装助手 1.16.6；扩展不会自动升级助手，已有模型可保留。独立安装用 chrome-local.zip，Chrome 商店审核用 chrome-store.zip。

## English

### Added and fixed
- Channels study in both editions: a share-page entry starts resolution through Tencent Yuanbao, shows sign-in/loading progress, and adds a caption bar and study entry to official playback pages.
- Standalone-only YouTube video/audio downloads through the local helper. YouTube file downloads remain disabled in the store edition.
- Helper 1.16.6 prefers compatible MP4 output with MKV fallback. YouTube first attempts anonymous access, then retries using previously authorized login support when needed.
- Preserve bilingual captions, caption styling and shortcuts, image chat, learning notes, supported-site downloads and recognition recovery. Update edition guidance, privacy disclosures and review instructions.

### Verification and limits
- Clean dependency installation, 1,337 frontend tests, 225 helper tests, TypeScript, nine-language checks and store-download policy checks pass; seven frontend cases retain their existing conditional skips.
- Channels entry, resolver states, source identity and tab cleanup pass automated regression tests. No WeChat client was automated. Live Channels sign-in, full caption generation and final downloads on every supported site are not verified for this build.
- Windows and Intel Mac hardware remain unverified. YouTube downloads depend on source-site login and format availability; live streams and DRM are unsupported.
- GitHub publication, store submission and public store availability are separate milestones.

### Upgrade
Refresh pages and reopen study mode after updating. Install helper 1.16.6 for the new download behavior; the extension does not upgrade it automatically and existing models can be kept. Use chrome-local.zip for standalone installation and chrome-store.zip for Chrome Web Store review.
