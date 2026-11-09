## 中文

- 从乔木 Publish 打开小红书、X 或知乎编辑页时，先等待不含交接片段的新页面就绪再写入，修复小红书创作页白屏。导航失败、跳错页或停止时不会继续写入。
- 新增 Atlas Cloud 模型服务预设，支持模型列表与流式对话，需自备该服务的 API Key。
- 搭配支持微博的乔木 Publish 版本，可预填微博正文、话题和配图，或创建微博长文草稿。现有短微博草稿会保留；停止或保存结果不确定时不会自动再建草稿。请在微博检查后手动发布。
- 本版也包含此前合入主干的 AI 侧栏标签隔离和 OAuth 续期修复。macOS 助手继续使用已签名的 1.16.9。

升级后刷新网页并重新打开扩展页面。微博需要两个插件版本均支持微博交接；此前的 Publish 0.3.4 没有该入口。真实平台账号写入和 Atlas 在线服务未在本轮复测。GitHub 发布与 Chrome 商店审核分别记录。

## English

- Wait for a fresh editor page without the handoff fragment before filling Xiaohongshu, X or Zhihu. This fixes the Xiaohongshu blank page and prevents writing after a failed navigation, a redirect to the wrong page, or cancellation.
- Add the Atlas Cloud provider preset for model discovery and streaming chat. Bring your own Atlas Cloud API key.
- With a compatible Qiaomu Publish version, prefill a Weibo post or create a Weibo article draft. Existing post drafts are preserved, and uncertain or stopped jobs do not automatically create another draft. Review and publish in Weibo yourself.
- Include the tab-scoped AI sidebar and OAuth refresh fixes already on main. The signed macOS helper remains at 1.16.9.

Refresh tabs and reopen extension pages after updating. Weibo requires a compatible version of both plugins; Publish 0.3.4 does not offer these targets. Live platform accounts and Atlas Cloud were not retested in this release. GitHub and Chrome Web Store availability are tracked separately.
