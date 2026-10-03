# 学习记录到今日日记（本地首版）

范围：网页选中／高亮、视频字幕选中／当前时间与无选中随手记，共用“记到今天日记”composer。默认聚焦“我的理解”；原文摘录、来源和时间可编辑或移除。纯想法或纯摘录均可保存，全空拒绝。AI 仅由用户显式加入已有问答，单独标明，不生成新回答、不覆盖原话。

composer 的 Cmd/Ctrl+Enter 保存、Escape 关闭保留草稿，不拦截普通复制、aaa 或其他输入，不修改播放器实例／状态。保存前显示解析出的库、今日日期与目标；未知配置不猜路径，跨午夜重新解析并要求用户确认新的目标。

记录顺序追加，自包含时间、来源链接、视频 t 链接、理解、可选摘录与独立 AI 段。追加不改 frontmatter／既有内容，不强制将历史记录重新归组。独立日记入口不经过公开 RSS 投稿，不读取未选正文或真实库作为开发素材。

状态：native 确认落盘才 saved；显式 URI 发送为 dispatched（未验证），中断／超时及可能部分落盘为 unconfirmed，不自动换 URI 重复提交。失败保留草稿，成功清理对应 captureId，关闭不删除真实记录。每次独立记录新 captureId，同 ID 同内容重试幂等，不按文本全局去重。

核心与 UI 契约位于 src/utils/learning-record.ts：LearningSource、LearningRecordDraft、DailyTargetResult、LearningSaveResult。核心提供 createLearningDraft、loadLearningDraft、persistLearningDraft、clearLearningDraft、getDailyTarget、saveLearningRecord、dispatchLearningRecord。草稿按来源最小必要本机存储；saveLearningRecord 接受已预览目标并在写入前重新解析，目标变化返回 target-changed。

Ownership：核心作者只修改 learning-record.ts／测试、local-save.ts 类型、native/host.py／测试、background.ts 新路由及本文件。UI 作者独占 reader.ts、reader-preview-shell.ts、clip-chat.ts、新 composer 与样式；不互改。整合基线 8e527a（共享 bar、字幕、153、尺寸成果），尺寸分支与构建保持冻结。独立本地 worktree／feature 分支，不 push、合并 PR、release 或发布商店。

实现原则：复用 daily_target 的真实本地日期／数字格式／配置目录。模板或复杂格式安全阻断；无 native 时仅提供明确标记为未验证的显式 URI 选择，不能假设实际日记路径。使用 captureId、预写回执 journal 和文件内标记恢复崩溃窗口；锁、一次 O_APPEND 追加及外部文件替换检测避免静默覆盖。草稿以原始来源索引及独立 captureId 键保存，清理一个记录不会删除其他标签页的新草稿。来源编辑不会改动草稿归属。URL 限定 http(s)，Markdown 转义，不接受来自学习记录的文件夹或路径。

验收仅临时库：已有／新日记、目录／数字日期、模板阻断、native缺失／URI、权限／中断／重复点击／并发／跨午夜、来源草稿、中文 emoji、长摘录、恶意 URL／路径。网页及字幕各一条选择→理解→保存→临时库真实回读，原文与 AI 独立，iframe 同节点同 src。核心作者反向审 UI；最终独立验收不能由 UI 作者自称完成。运行 npm test、npx tsc --noEmit、native unittest、Chrome build；没有独立 lint 命令。真实视频若遇到 auth 或扩展内部页审批限制，如实标为未验证，不绕过。

## 核心本地验证

2026-10-03：独立 worktree `qiaomu-clipper-learning-core`，基线 8e527a。最终扩展测试 325 项、TypeScript 检查、native 25 项临时库测试与 Chrome production build 通过；构建保留原有 3 项体积提示，无独立 lint 命令。

覆盖：原正文/frontmatter 保留、每 capture 去重、不同 capture 同文追加、并发、权限、预写中断、写后回执中断、跨午夜目标重新确认/旧写入回读、外部追加/原子替换、中文/emoji/长摘录、安全来源链接、模板/复杂配置阻断、旧助手/同步或异步通信错误/超时、URI 未验证状态及重复阻断、编辑来源与提交后编辑/另一个 capture 草稿保留、独立私密路由。

仍未完成：composer UI 接线、网页和字幕完整选择到临时 native 真实文件回读的界面验收；本地已安装助手未更新，真实库未读取或写入。此提交是核心交付，不是完整学习记录功能验收，不覆盖用户加载的 root dist，不发布。

## 接手后的界面与格式调整（2026-10-03）

核心的幂等、回执与恢复逻辑未改；调整的是写进日记的格式和记录界面。

**写入格式**：每条记录一行标题加正文，不再重复「### 视频与阅读笔记」和「记录时间／来源／视频时间」三行清单。

```
#### 14:32 · [视频标题](链接&t=364) · [6:04](链接&t=364)

我的理解（原样写入，[[双链]]、#标签、列表照常生效）

> [!quote] 原文摘录
> …

> [!info] AI 补充（我选择加入）
> …
```

- 视频时间点可点击跳回（YouTube 与 B 站都带 `t`）；没有来源时标题为「随手记」。
- 「我的理解」是用户自己写的，不再转义；来自网页或 AI 的摘录与补充只中和 HTML 和 `[[ ]]`／`![[ ]]`，其余保持可读。
- 在临时库用真实 native 助手写入后回读核对：原有 frontmatter 与正文保留，三条记录依次追加，标记注释在阅读视图不可见。

**记录界面**：由居中的模态对话框改为右下角的小卡片（非模态）。写笔记时视频继续播放、字幕仍可选择；新选中的文字在卡片打开时会填入空的摘录，或以「改用本次选中的摘录」提供，不覆盖已写内容。

- 主区只有「我的理解」，摘录以引文样式显示（可移除、可再添加），视频时间是标题旁的小标签，点击可改；来源、高亮选择折叠在下方；去向「→ 10 Daily/2026-10-03.md · 库名」缩成底部一行小字，只有不可用时才出现「重新确认目标」和 URI 备选。
- 入口：顶栏笔记图标、选中文字胶囊里的「记笔记」、AI 回答的「加入日记」，新增单键 **N**（不含修饰键、不在输入框内）。设置页新增「学习笔记」开关，关闭后隐藏按钮、胶囊入口和 N（页面重开后生效）。
- 时间：优先取选中字幕行，其次 YouTube 上报的播放位置，再其次当前高亮的字幕行（B 站没有播放 API，取最近一次点击跳转的那一行）。

**字幕上的笔记标记**：保存成功后，本机记住「这个视频的第几秒、一句摘要」（`qiaomuLearningMarks:<视频>`，最多 300 条），在对应字幕行的时间后显示小铅笔，悬停时间可看摘要。笔记正文只在日记里，标记只是本机索引。

**仍未验证**：已安装的本地助手（`~/.local/share/qiaomu-clipper/host.py`）还是旧版，不含学习日记动作，需要重新运行 `native/install.py` 才会启用；真实扩展页内的卡片外观与浮出窗口的相互遮挡；Firefox／Safari。
