# PR #33 审查与选择性合并

审查版本：`63584644a9b7a6430ace62e67587a3e305cc963c`。

已选择 OpenAI/Magpie endpoint 兼容修复（`efddd910`、`ad1d0e6`），保留贡献者署名，PR #34 已合并至 main（`6ecabaa0b426e05e52e614326e89d914a6b8f3bc`），1.11.2 已发布三个浏览器安装包，远端摘要与本地产物一致。

## 暂缓整体合并的问题

1. **旧用户字幕翻译失效（P1）**：`storage-utils.ts:224` 将新增 translationModel 置空；`youtube-translation.ts:255-256` 仅接受该字段，不再回退到原来的可用聊天模型。已有用户升级后需要重新设置才能翻译。
2. **确认 Whisper 后原字幕重复（P1，已复现）**：`youtube-study.ts:126` 优先替换 live preview，而原 sourceTranscript 仍连接。新增回归用例预期一个 transcript，实际得到两个。`transcriptText` 会读取两份字幕，影响导出和 AI 上下文。
3. **音频积压误删未处理窗口（P2）**：`youtube-study.ts:184-191` 在 await 推理期间将当前窗口保留在 queue[0]；`250-254` 溢出剪裁可能已删除该窗口，推理返回再 shift 会误删另一待处理窗口。应把执行中的窗口与待处理队列分开，并明确积压丢帧策略。

## 验证

- 原 PR：512 项既有测试与类型检查通过；新增字幕替换回归用例失败。
- 选择性分支：479 项扩展测试、40 项 Native helper 测试、类型检查通过。
- Chrome / Firefox / Safari 生产构建通过；ZIP 完整性和 1.11.2 manifest 核验通过。
- 本次未验收真实网页音频共享、Whisper 模型加载、设置页视觉与多设备实时体验。PR #33 保持开放。

[原 PR #33](https://github.com/joeseesun/qiaomu-clipper/pull/33) · [选择性 PR #34](https://github.com/joeseesun/qiaomu-clipper/pull/34)

GitHub PR #34 CI 已通过：[验证记录](https://github.com/joeseesun/qiaomu-clipper/actions/runs/37290542471)。

[1.11.2 Release](https://github.com/joeseesun/qiaomu-clipper/releases/tag/1.11.2)
