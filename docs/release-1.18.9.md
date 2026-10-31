## 中文

### 新增与修复
- 在原网页旁打开独立 AI 对话侧栏，可从弹窗、右键菜单或快捷键进入，并引用网页选区；基于 water-70689368 的 PR #90，经 PR #92 整合。
- 切换标签页、刷新或跳转后重新读取当前页面，按完整网址隔离对话记录，包括页面内的哈希路由，避免把上一页内容带入新问题。
- 关闭侧栏或离开页面时取消未完成的请求，清理事件监听、图片会话与定时任务；保留 1.18.8 的代码块与缩进修复。

### 验证与限制
- 功能提交通过 1,508 项前端测试（7 项跳过）、19 项构建工作流测试、18 个注入函数检查、TypeScript 检查、225 项助手测试及 60 项下载策略测试（2 项跳过）。
- Chrome 商店版、独立版、Firefox 与 Safari 生产构建通过。回归测试覆盖页面切换、加载中导航、迟到的页面内容、哈希路由、对话取消和侧栏清理。
- 真实 Chrome 的入口操作、选区引用、侧栏关闭重开、与剪藏侧栏共存及真实模型流式回答仍需实机验收；Firefox 与 Safari 仅完成构建验证。自动测试通过不代表这些实机检查已经完成。
- GitHub 发布、商店提交、审核与公开安装分别记录；本说明不表示商店已经更新。

### 升级
升级扩展后刷新网页并重新打开侧栏。助手保持 1.16.6，无需重新安装助手；现有文章与设置保留。商店版继续不提供 YouTube 文件下载。

## English

### Added and fixed
- Open a separate AI chat sidebar beside the original page from the popup, context menu or keyboard shortcut, and quote selected page text. Based on water-70689368's PR #90, integrated through PR #92.
- Refresh page context after switching tabs, reloading or navigating. Separate chat history by the full URL, including hash routes, so content from a previous page does not enter a new question.
- Cancel pending requests and clean up event listeners, image sessions and scheduled work when the sidebar closes or the page leaves. Retain the code-block and indentation fixes from 1.18.8.

### Verification and limits
- The feature commit passes 1,508 frontend tests (seven skipped), 19 build workflow tests, 18 injected-function checks, TypeScript, 225 helper tests and 60 download-policy tests (two skipped).
- Chrome store, Chrome standalone, Firefox and Safari production builds pass. Regression tests cover tab switches, navigation while loading, stale page results, hash routes, cancellation and sidebar disposal.
- Actual Chrome entry points, selection quoting, closing and reopening the sidebar, coexistence with the clipping sidebar and real model streaming still need device verification. Firefox and Safari have build verification only. Automated checks do not establish these device results.
- GitHub publication, store submission, approval and public availability are recorded separately; these notes do not imply a store update.

### Upgrade
Refresh pages and reopen the sidebar after updating the extension. Helper remains 1.16.6 and does not need reinstalling. Existing articles and settings are retained. The store build continues to exclude YouTube file downloads.
