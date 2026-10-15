## 中文

### 新增与修复
- 重新整理播放器下方布局：布局切换、下载、原站高清集中在同一工具栏；字幕提示与生成、重试统一左对齐，宽屏和半屏都保持清晰分组。
- 修复 Chrome 存储对象键顺序变化导致的草稿冲突误报，真实跨页面修改仍会受到保护。
- B 站、抖音、小宇宙等非 YouTube 学习页统一提供下载入口；分离音视频与回放由本机助手保存完整文件，显示进度并支持取消。小宇宙的入口不再挤在倍速控件里。
- 修复 B 站学习页点击画面意外打开原站，现在可点击播放／暂停；保留原生控件，提供明确的原网页高清入口并保留分 P。感谢 @shyboy 提交 #81。
- 修复 Star History 等 SVG 图表无法在 AI 对话中读取的问题，转换为实际图片随问题发送。
- 修复本机模型失败后无法切换云端的问题；重试时可重新选择模型，切换选择不会自动上传音频。
- 修复笔记库看似选中却未保存、已安装助手因笔记库路径失效而误报未连接的问题。
- 助手 1.16.5 修复签名 Python 加载 MLX 失败；模型安装和识别前检查实际运行环境，错误保留关键原因。

### 验证与未验证
- 通过真实 Chrome 下载按钮保存并合并 212 秒 B 站视频，文件约 21 MB，确认包含视频、音频和完整时长。抖音、小宇宙的真实最终整包下载尚未逐站验收。
- 1,310 项前端测试、219 项助手测试、TypeScript、九语言及商店下载检查通过。
- 已用签名 Python 完成 Qwen3-ASR 离线识别，并验证实际 SVG 转图片及图片请求格式。固定测试入口已重载并验证助手连接。
- 用户另一台 M5、Intel、真实云端识别和 DeepSeek 实际图像回复尚未验证。真实 Chrome 已核对 B 站播放器加载、字幕重试、宽屏／半屏布局及小宇宙 59:11 音频与下载入口；这些界面验收不替代逐站最终文件下载验收。
- B 站官方外嵌画质仍受平台限制；Chrome 商店版不提供 YouTube 媒体文件下载。GitHub 发布不代表商店已更新。

### 升级
更新扩展后刷新原网页并重新打开阅读／学习页。本机模型用户请同时下载安装助手 1.16.5，扩展更新不会自动升级助手；已下载模型可保留。GitHub 独立安装选择 chrome-local.zip，chrome-store.zip 用于商店提交。

## English

### Added and fixed
- Group layout controls, downloads and original-page HD access in one player toolbar. Keep subtitle status, generation and retry actions together and left-aligned on wide and half-width windows.
- Prevent false draft conflicts caused by Chrome reordering stored object keys while retaining protection against real edits from another page.
- Add a consistent download entry to non-YouTube study pages, including Bilibili, Douyin and Xiaoyuzhou. The local helper exports split streams and replays as complete files with progress and cancellation. Podcast downloads sit outside the playback-speed row.
- Keep Bilibili picture clicks inside the study player for play/pause. Preserve native controls and provide an explicit original-page HD link with the selected part. Thanks to @shyboy for #81.
- Read SVG charts, including Star History, by converting them into actual image attachments for AI chat.
- Let users choose a different model after local recognition fails. Selecting a cloud service does not start an upload automatically.
- Save vault selections reliably and keep an installed helper connected when its configured vault path becomes invalid.
- Helper 1.16.5 fixes MLX loading under the signed Python runtime, checks the actual recognition environment and preserves useful error details.

### Verification and limits
- A real Chrome download-button run for a 212-second Bilibili video produces a complete 21 MB file with video and audio streams. Live final-package downloads from Douyin and Xiaoyuzhou still need per-site acceptance.
- 1,310 frontend tests, 219 helper tests, TypeScript, nine-language checks and store-download checks pass.
- Real signed Python completes offline Qwen3-ASR recognition. Actual SVG-to-image conversion and image request formatting pass. The fixed Chrome test extension was reloaded and its helper connection checked.
- Another user's M5, Intel hardware, live cloud recognition and an actual DeepSeek image response remain unverified. Real Chrome checks cover the loaded Bilibili player, subtitle retry, wide and half-width layouts, and the Xiaoyuzhou 59:11 audio player and download entry. UI acceptance does not replace final-file download acceptance for each site.
- Bilibili's official embed quality remains restricted by the platform. The Chrome Store edition does not download YouTube media. This GitHub release does not update the store listing.

### Upgrade
Refresh source pages and reopen the reader or study page after updating. Local-model users should also install helper 1.16.5; extension updates do not update the helper automatically. Existing downloaded models can be kept. Use chrome-local.zip for standalone installation and chrome-store.zip for store submission.
