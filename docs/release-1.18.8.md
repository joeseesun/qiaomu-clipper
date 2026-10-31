## 中文

### 修复
- 修复网页、ChatGPT 对话和命令行剪藏中代码块、ASCII 流程图、缩进、空行与语言标记丢失，沿用 water-70689368 的 PR #89 并补齐嵌套列表内 Tab 保留。
- 包含已合入 PR #88 的修复：字幕段落保留必要空格，没有视频的 X 长文进入普通沉浸阅读。

### 验证与限制
- 最终修复通过 1,488 项前端测试（7 项跳过）、19 项构建工作流测试、17 个注入函数检查和 TypeScript 检查；225 项助手测试、60 项下载策略测试通过（2 项跳过）。
- 独立回归覆盖列表、引用、表格、嵌套 Makefile Tab、尾随空格、空行、ASCII 图和 HTML 字符，经 Markdown 解析与预览净化后检查原始文本。真实站点结构可能继续变化；本次没有验证所有文章或其他操作系统实机。
- 商店提交、审核通过和公开安装是不同状态，以商店当前记录为准。

### 升级
刷新网页并重新打开阅读页。助手保持 1.16.6，无需重新安装助手；现有文章与设置保留。商店版继续不提供 YouTube 文件下载。

## English

### Fixed
- Preserve code blocks, ASCII diagrams, indentation, blank lines and language labels in web, ChatGPT and CLI clipping. Incorporate water-70689368's PR #89 and preserve recipe tabs inside nested lists.
- Include PR #88: keep required spaces between subtitle paragraphs and route X articles without video to standard immersive reading.

### Verification and limits
- 1,488 frontend tests pass (seven skipped), plus 19 build workflow tests, 17 injected-function checks, TypeScript, 225 helper tests and 60 download-policy tests (two skipped).
- Regression fixtures cover lists, blockquotes, tables, nested Makefile tabs, trailing spaces, blank lines, ASCII diagrams and HTML characters through Markdown parsing and preview sanitization. Live site structures may change; not every article or operating system has been tested.
- Store submission, approval and public availability are separate states; consult the current store record.

### Upgrade
Refresh pages and reopen the reader. Helper remains 1.16.6 and does not need reinstalling. Existing articles and settings are retained. The store build continues to exclude YouTube file downloads.
