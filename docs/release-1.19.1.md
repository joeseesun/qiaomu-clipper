## 中文

### 新增与修复
- AI 对话支持上传、粘贴和拖入图片，恢复历史时保留附件；增加跨页面历史、问答轮次导航和收藏。
- 阅读历史对话时保持滚动位置；优化字幕翻译组批和并发；抖音私信页面不再显示视频学习工具栏。
- 修复章节说明后的正文短列表被误删，保留项目、行内格式和相对链接。

### 验证与未验证
- 1,715 项前端测试、60 项商店下载策略、类型检查及 235 项原生回归通过；原缺陷用例与列表、代码块共 24 项回归通过。
- 本轮尚未完成最终包的真实 Chrome 新装、升级、重载、设置保存、剪藏和登录续期验收。商店后台访问被工具拒绝；上传和审核状态须另行回读，不把构建成功视为已提交。
- 未纳入其他开放 PR，包括 OAuth 续期修复 #113；本地助手仍为 1.16.9。

### 升级
更新后刷新网页，重新打开扩展页面。文章、设置和历史数据保留。商店版仍保留媒体下载限制。

## English

### Added and fixed
- Upload, paste and drop images into AI chat and retain attachments in history. Browse history across pages, navigate turns and bookmark conversations.
- Preserve the reading position in conversations, improve subtitle translation batching and concurrency, and hide the study toolbar on Douyin private-message pages.
- Preserve short article lists following section introductions, including inline formatting and resolved relative links.

### Verification and limitations
- 1,715 frontend tests, 60 store download-policy tests, TypeScript and 235 native regression tests passed. The previously failing reproduction and list/code preservation checks passed all 24 tests.
- Final-package installation, upgrade, reload, settings, clipping and authentication renewal in real Chrome remain unverified. Dashboard access was denied by the tool; uploading and review status require separate confirmation.
- Other open PRs, including OAuth renewal fix #113, are excluded. The helper remains 1.16.9.

### Upgrade
Refresh website tabs and reopen extension pages after updating. Existing articles, settings and history are retained. Store media-download restrictions remain in effect.
