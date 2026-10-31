# 2026-10-17 PR 与工作区整合

远端基线：`2aea513`（PR #83，1.18.6）。本次检查的是代码合入 main；不更新版本号、不替换商店包，也不覆盖固定测试入口。

## 本次候选

- `e42dbfc`：小宇宙紧凑播放条、播放器与文稿吸顶层级和当前句避让。保留阅读页 AI 对话 UI。
- `2d2649e`、`e5e4d5e`、`e298377`：写长文、本地文章库、编辑器、大纲、写作助手、生图配置与 X 文章草稿入口。
- 两条开发线已在 `2007741` 合并，来源工作区 `qiaomu-clipper-integration` 与 `qiaomu-clipper-write` 均干净。本次从这个提交建立隔离集成分支，原工作区不改动。
- 合并审查发现并修复文章数据库并发问题：发布回执写入与正文保存采用事务内读取；保存保留最新发布回执；移入和恢复回收站递增修订号，阻止旧编辑器复活文章。三个新增用例在修复前均失败，修复后通过。

## 仍打开的旧 PR

| PR | 判断 | 处理 |
| --- | --- | --- |
| [#32](https://github.com/joeseesun/qiaomu-clipper/pull/32) | 强制中文字幕优先，与主线现有原声音轨优先、用户选择字幕语言的逻辑不同。主线 `youtube-captions.ts` 已改用 `subtitle-language.ts` 的 `chooseTrack`。 | 不直接合并，避免恢复旧产品行为。 |
| [#33](https://github.com/joeseesun/qiaomu-clipper/pull/33) | GitHub 显示冲突；67 个文件同时修改设置、播放器、字幕与音频捕获。双语导出和布局已有后续实现，浏览器内 Whisper 则是另一条未纳入主线的识别路径。 | 不整包合并；浏览器内 Whisper 如需保留，应基于当前识别配置单独拆分和验证。 |
| [#47](https://github.com/joeseesun/qiaomu-clipper/pull/47) | Windows 修复已部分由主线覆盖，但 PR 混入第二套下载协议与打包器。新增按钮传 `source: native`、`cookiesTxt` 和空 `save`，没有提供当前控件实际使用的 `download` 回调；按钮会走直接获取网页 URL 的路径。打包器读取已废弃的 `dist_local/dist`，不是现有生产构建目录。 | 当前不能直接合并。应只移植仍缺失的 Windows 修复，再跑 Windows 真机与打包验证。 |

以上 PR 保持打开，本次没有替作者关闭、发表评论或改写分支。

## 工作区核对

检查了原有 20 个工作区（含独立 Orca checkout），比较提交祖先关系、等价补丁、未提交差异与当前源码。旧工作区的残留 diff 不能当作完整待合功能，也不能仅因提交已合入就认定所有残留均已交付。

| 来源 | 结果 |
| --- | --- |
| `qiaomu-clipper-integration` / `qiaomu-clipper-write` | 本次候选，写长文的三个提交只合入一次。 |
| `qiaomu-clipper-publish-bridge` | 未提交：4 个已跟踪文件修改与 13 个新文件。连接 Obsidian、X、知乎、小红书的新路径保留在原处，须先独立提交和验证。 |
| `helper-asr-recovery` / `native-study-caption-parity` / `study-action-overflow` / `qiaomu-clipper-channels` / `qiaomu-clipper-ytdl` | 已提交内容已包含在主线，工作区干净。 |
| `qiaomu-clipper-learning-core` | 两个提交经 `git cherry` 确认为主线已有等价补丁。 |
| `qiaomu-clipper-fix-153` | 播放器 Referer 规则实现与主线相同，不能把旧版本文件整体恢复。 |
| `qiaomu-clipper-learning-ui` | 设置按钮和学习记录入口顺序在当前源码中已有对应实现；旧测试残留保留。 |
| `qiaomu-clipper-editions` | 未提交文档仍写“两版均不下载 YouTube”，与 1.18.6 独立版能力冲突，未合入。 |
| Orca `halibut` | 只有锁文件空白差异，忽略空白后无变化。 |
| 主 checkout / `player-chinese-captions` / `captions-stable-delivery` / `doubao-karaoke` / `study-playback-handoff` / `study-test-integration` / `subtitle-edit-controls` | 保留全部未提交文件。既往整合见 `STUDY-INTEGRATION-2026-10-13.md`；本次又检查了当前文件及反向补丁可应用性，大量差异已存在或经历后续修改。剩余旧差异未逐项重新功能验收，不整体合并、不删除工作区。 |

## 测试包边界

检查时固定入口的 `CURRENT.json` 为商店版 1.18.6，源码 `200774132b519d11cdae5b8bfe26d465d7bf55bf`，来源 `qiaomu-clipper-publish-bridge`，`dirty: true`，摘要 `13ae93bea2673f907399a79e959d0c3cbf5e5401309ddc3d8c29a8bcf1575767`。

它已含 26 项登记功能，额外包含未提交的 `obsidian-publish-bridge`。本次 main 候选只有其中 25 项，**不能用它覆盖当前测试包**。下次准备测试时必须先收齐发布桥，再执行正常交付脚本。

## 验证范围

集成前 `2007741`：工作流 19 项通过；Vitest 1,438 通过、7 跳过；TypeScript 通过。新增数据库回归修复前 3 项失败，修复后文章存储 13 项通过。最终提交还需完整自动检查与 CI。

播放器已有上次本地浏览器验收记录；本次不宣称重新验证了安装运行。写长文的真实模型、生图账号、真实 X Premium 草稿写入与扩展 CSP 验证限制见 `WRITE.md`，本次不以单元测试代替它们。发布桥及 Windows 真机均未做真实端到端验收。

## 第二轮：发布桥与写作助手

上面的表格是第一轮检查快照；第一轮已通过 PR #84 合入 `31165a9`。本轮以已安装的 `7ab050a`（写作助手改进）为基线，合入 PR #85 的 `f75ef5c`（发布桥）。写长文工作区的 `87c7493` 与 `7ab050a` 是等价增量，只保留一次。没有修改阅读页 AI 对话界面。

发布桥现已独立提交，原发布桥工作区干净。AI 面板工作区仍有未提交的发布桥副本，保留原样。固定测试入口检查时为 1.18.6 / `7ab050a` / dirty，包含 26 项功能；本轮源码保留全部功能，并新增写作助手改进的显式登记，共 27 项。本轮只合并代码，不替换固定测试包。

合并审查补了五项先失败、后通过的回归检查：取消后的图片发送、取消后的页面启动指令、小红书等待上传入口时取消、小红书图片未全部就绪、知乎最后一张图片上传期间取消。现在观察到取消后不会继续下一步写入，图片不足会报错；已发出的网络请求不保证撤回。另有正常上传并填写标题正文的对照测试，确认不触发发布按钮。

验证：工作流 19 项、注入检查 17 个函数、Vitest 1,455 通过 / 7 跳过、TypeScript 通过。用真实编辑器与面板源码构建浏览器夹具（模型响应与扩展存储为模拟），验证 1512px 桌面及 390px 窄屏、拖动和键盘调整宽度、双击恢复 420px、生成中的字数进度与完成后的插入卡片。窄屏无水平溢出，模型与思考强度控件不重叠。截图和夹具保留在本地 QA 目录，不进 Git。

没有执行真实账号的 X/知乎/小红书草稿写入、真实模型生成、Chrome 扩展重载或商店提交。旧 PR #32/#33/#47 的阻碍不变，本轮不整包合并。最终远端合并以 GitHub PR 和 CI 为准。
