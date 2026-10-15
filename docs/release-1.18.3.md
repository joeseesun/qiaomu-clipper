## 中文

### 新增与修复
- 字幕支持直接拖动并确认位置、分别调整中英文字体与样式；五款开源字体按需加载。
- 已有字幕可换模型重新生成；简化重复按钮，文稿标题吸顶并遮挡上方滚动文字。
- 播放器支持 K／空格播放暂停、J／L 前后跳转 10 秒与 3 倍速；新增可关闭的小技巧。
- 进入沉浸学习或连按三次 A 时暂停原页，接续原进度播放；全屏操作栏自动隐藏。
- 接入豆包返回的逐字／逐词时间，支持字幕卡拉 OK 高亮。

### 验证与未验证
- 1,240 项前端测试、208 项助手测试、多语言和类型检查通过；真实浏览器模拟页验证拖动、标题吸顶和技巧条。
- 真实豆包音频的对齐质量和各网站播放仍需现场验收；Qwen 对齐模型未加入。
- 商店版仍不提供 YouTube 媒体文件下载。

### 升级
更新扩展后刷新原网页并重新打开学习页。豆包词级时间需升级本地助手到 1.16.3（从本版源码运行 native/install.py），然后重新生成字幕；扩展更新不会自动升级助手。

## English

### Added and fixed
- Drag subtitles directly and confirm their position; style each language independently with five on-demand open-source fonts.
- Regenerate existing subtitles with another model. Remove duplicate actions and keep the transcript heading opaque and sticky.
- Add K/Space playback, J/L ten-second seeking, 3x speed and dismissible learning tips.
- Pause the source page and resume its position in study mode, including the triple-A shortcut. Auto-hide fullscreen controls.
- Preserve Doubao word timings for karaoke-style subtitle highlighting.

### Verification and limits
- 1,240 frontend tests, 208 helper tests, localization and type checks pass. Browser fixtures verify dragging, sticky headings and tips.
- Live Doubao alignment quality and site-specific playback still need real-world acceptance. Qwen alignment is not included.
- The store edition does not download YouTube media files.

### Upgrade
Refresh the source page and reopen study mode after updating. Doubao word timings require helper 1.16.3: run native/install.py from this release and regenerate subtitles. Updating the extension does not update the helper automatically.
