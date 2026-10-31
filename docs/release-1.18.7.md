## 中文

### 新增与修复
- 小宇宙使用紧凑播放条，滚动文稿时播放控件保持可见，当前句避开吸顶区域；保留阅读页原有 AI 对话界面。
- 新增写长文：本地文章库、编辑器、大纲、导入导出、写作助手与配图入口。助手支持调整宽度和长文生成进度。
- 支持从 Obsidian 乔木 Publish 交接文章，在 X、知乎和小红书准备草稿；最终发布由用户确认。
- 修复文章并发保存覆盖发布回执，以及取消后继续写入、图片未齐误报完成的问题。保留视频号学习等此前功能。

### 验证与未验证
- 功能基线 418f7f5：1,455 项前端测试通过、7 项跳过，助手测试、TypeScript、多语言、下载策略、多浏览器构建和打包 CI 通过。
- 播放器与写作面板通过源码浏览器夹具检查；真实模型/生图、平台账号草稿写入和 Windows/Intel Mac 真机尚未完整验收。商店提交不等于审核通过。

### 升级
刷新网页并重新打开阅读/写作页。助手继续使用 1.16.6；商店版不提供 YouTube 文件下载，独立版对应能力需要助手。更新前可导出本地写作文章备份。

## English

### Added and fixed
- Compact podcast controls remain visible while scrolling transcripts and keep the current sentence clear of sticky controls. The reader's existing AI chat is preserved.
- Add local long-form writing with an article library, editor, outline, import/export, writing assistant and image-generation entry points. The assistant supports resizing and generation progress.
- Receive articles from Obsidian Qiaomu Publish and prepare drafts on X, Zhihu and Xiaohongshu; final publication stays with the user.
- Protect publishing receipts during concurrent saves, stop subsequent writes after cancellation, and reject incomplete image uploads. Retain Channels study and earlier features.

### Verification and limits
- Feature baseline 418f7f5: 1,455 frontend tests pass, seven skip; helper tests, TypeScript, translations, download policy, browser builds and packaging CI pass.
- Player and writing panel checked in source-based browser fixtures. Live model/image generation, signed-in platform drafts and Windows/Intel Mac hardware remain incompletely verified. Submission does not mean approval.

### Upgrade
Refresh pages and reopen reading/writing views. Helper remains 1.16.6. YouTube file downloads are excluded from the store build and require the helper in the standalone build. Export local articles for backup before updating.
