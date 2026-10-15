## 中文

### 新增与修复
- Chrome 商店版新增学习页完整视频/音频文件下载，首次点击才申请下载权限；保留独立版。
- 商店版在入口和实际下载时检查原页面及媒体来源，禁止 YouTube 文件下载，不跟随下载重定向，不提供 DRM 解密或分段/分轨合并。
- 下载支持进度与取消，等待浏览器确认文件保存完成后再显示成功；拒绝权限不会发起下载。
- 包含 1.17.0 的小红书提取与实际图片问答。助手仍为独立编号 1.16.2，本次无需升级助手。

### 验证与边界
- 1,120 项默认配置测试、9 项构建流程测试、45 项商店下载测试及 TypeScript 检查通过。默认配置跳过的 6 项商店专用检查已在商店测试中执行通过。
- 真实浏览器检查了实际组件与阅读页 CSS 的正常/权限拒绝状态、图标和 YouTube 隐藏入口；测试 API 用于模拟权限拒绝，此项不是商店包全新安装证明。
- 本次未逐站完成已安装扩展的媒体下载验收，不保证每个站点都返回可保存的完整文件。某些来源仍需要助手提取媒体地址；完整文件由浏览器直接保存。
- 现有字幕生成与媒体文件保存是不同功能；字幕生成可能由助手临时下载音轨，详见隐私说明。只保存你有权下载的内容。
- GitHub 发布、提交商店审核和审核通过分别确认。此说明不代表商店已上线本版。

### 升级
更新扩展并刷新原网页、重新打开学习页。固定测试入口保持不变。商店包使用 `chrome-store.zip`；独立安装使用 `chrome-local.zip`。

## English

### Added and fixed
- The Chrome store edition can save complete media files from supported study pages, requesting optional downloads permission only on click. The standalone edition remains available.
- Store downloads validate both the original page and media host, reject YouTube sources and redirects, and do not decrypt DRM or merge segmented/split streams.
- Progress and cancellation are available. Success is shown only after the browser confirms the file was saved; denied permission does not trigger a fetch.
- Includes 1.17.0 Xiaohongshu extraction and actual-image chat. The independently versioned helper remains 1.16.2; this update does not require a helper upgrade.

### Verification and limits
- Passed 1,120 default-edition tests, 9 build-workflow tests, 45 store-download tests and TypeScript checks. Six store-only cases skipped in the default suite passed in the store suite.
- Inspected the real component and reader CSS in a browser, including permission denial, icons and absence of the YouTube download control. The permission API was simulated; this does not establish fresh installation of the store package.
- Installed-extension downloads were not retested on every site. Some sources still need the helper to obtain a media URL; complete files are saved directly by the browser.
- Existing subtitle generation may temporarily acquire source audio through the helper, as disclosed in the privacy policy. Only download content you have permission to save.
- GitHub publication, store review submission and store approval are separate states. These notes do not claim store availability.

### Upgrade
Reload the extension and source page, then reopen the study page. Use `chrome-store.zip` for store submission and `chrome-local.zip` for standalone installation.
