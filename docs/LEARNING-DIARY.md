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
