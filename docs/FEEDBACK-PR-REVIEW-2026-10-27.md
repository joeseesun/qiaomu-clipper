# 用户反馈与 PR 整理（2026-10-27）

本轮检查 GitHub 所有开放条目：5 个 issue、10 个 PR。读取正文、变更文件与补丁、已有维护者回复及检查结果，并对相关当前源码核对；这是一轮分流和两项修复验收，不等于对所有大型 PR 完成逐行审查。检查来源为 joeseesun/qiaomu-clipper，基线 `cbd122c03f41ad46025a1050f33f9bd957260b0f`，集成工作区 `qiaomu-clipper-image-captions`。保留该工作区此前未提交功能，包括翻译提速、网页图片输入及 X 媒体恢复。

## 本轮吸收

| PR | 作者与检查的 head | 本地处理 |
| --- | --- | --- |
| [#102 抖音学习条挤压私信](https://github.com/joeseesun/qiaomu-clipper/pull/102) | shyboy · `6746db6a6e953d5b08be764446a24b23b78ea57e` | 私信面板可见时隐藏学习条；移除按侧栏尺寸猜测插入位置的逻辑，保留明确“推荐视频”锚点；旧的错误插入恢复到 body。包含注入检查器的路径标准化及回归。 |
| [#98 AI 对话保留阅读位置](https://github.com/joeseesun/qiaomu-clipper/pull/98) | water-70689368 · `b4f2fd7510834271c5ad22fc2abb7b2fc18628a7` | 发送、输出、完成不再强制到底部；提供“回到底部”按钮；ResizeObserver 更新按钮可见性但不改变滚动位置；销毁时清理监听；补齐八份译文目录（简中用源文案）。打开历史会话仍定位末尾。 |

本地采用上述贡献的源码和测试，未执行 GitHub 合并、评论、关闭或发布。后续提交需保留贡献来源。

## 其余 PR

| PR | 判断与下一步 |
| --- | --- |
| [#99 上传/粘贴/拖入图片](https://github.com/joeseesun/qiaomu-clipper/pull/99) | 优先继续整合，但不能整包直接采用。补丁删除 `ChatImageSession`、网页图片勾选、单图提问及实际网页图片读取发送路径；应将用户附件作为新增输入并保留现有网页图片能力。验证附件大小、模型支持、历史恢复与失败重试。 |
| [#101 跨页面历史](https://github.com/joeseesun/qiaomu-clipper/pull/101) | 43 个文件，涉及 IndexedDB 迁移、删除清理和来源页恢复。先专门验证旧数据迁移、异常中断、并发写入、删除重试，再与 #99 的附件存储整合。CI 通过不代表用户数据迁移已验收。 |
| [#100 轮次导航/收藏](https://github.com/joeseesun/qiaomu-clipper/pull/100) | 与 #99/#101 都修改对话和历史模块；待历史数据结构确定后接入，验证收藏跨重载保留、删除和定位。不能把“补丁能应用”当成三份功能可同时使用。 |
| [#97 Token Plan 原生工具](https://github.com/joeseesun/qiaomu-clipper/pull/97) | 33 个文件，涉及 Responses、工具与思考参数。需按提供商/接口/模型建立兼容验证，保留本轮翻译明确关闭 DeepSeek 思考的行为。当前 CI 通过；本轮未用真实服务验收，也未认定模型目录仍有效。 |
| [#103 Cheaper Inference 预设](https://github.com/joeseesun/qiaomu-clipper/pull/103) | 小改动，但预设意味着产品推荐；本轮未见检查记录，新增测试只覆盖模型列表 URL 转换。服务、模型、鉴权和接口能力未验证前先保留自定义提供商入口，不直接新增推荐。 |
| [#47 Windows Whisper](https://github.com/joeseesun/qiaomu-clipper/pull/47) | 旧基线。已有维护者回复记录路径、取消、CUDA 回退、引擎及 IPv6 的部分修复已吸收；剩余 Cookie 持久化/授权、默认镜像、打包流程应拆开。上述剩余风险来自现有审查记录，本轮未重做 Windows 真实安装验收。 |
| [#33 浏览器 Whisper/字幕/布局](https://github.com/joeseesun/qiaomu-clipper/pull/33) | 67 个文件、旧基线。已有维护者回复记录 endpoint 和晚加载入口已吸收；还记录实时队列可能丢未处理音频及翻译模型迁移缺口。应单独验证完整音频覆盖，不能凭已有本机字幕功能认定浏览器实时实现完成。本轮未重新执行其音频链路。 |
| [#32 中文字幕优先](https://github.com/joeseesun/qiaomu-clipper/pull/32) | 当前 `subtitle-language.ts` 优先用户显式选择、原始语言，再做回退，并按视频记忆选择。当前还有原文/中文/双语模式。旧补丁需要按现有语言选择语义重写，不能以全局中文优先覆盖用户选择。 |

建议后续顺序：图片附件的增量整合 → 历史迁移 → 轮次导航/收藏；提供商接口与 Windows/浏览器 ASR 分开验收。

## 开放 issue

| Issue | 当前证据与处理建议 |
| --- | --- |
| [#41 OpenCode Go 请求头](https://github.com/joeseesun/qiaomu-clipper/issues/41) | 当前 `opencode-go.ts` 已提供 `x-opencode-session`；`chat-llm.test.ts`、`provider-models.test.ts` 覆盖相关行为。已有维护者回复说明此前发布及 Chat Completions 支持范围。可以请报告者更新后复测，不重复实现。未据此自动关闭 issue。 |
| [#62 Windows state.json 冲突](https://github.com/joeseesun/qiaomu-clipper/issues/62) | 当前 `native/asr.py`、`native/host.py` 两个原子写入均有 PermissionError 有界重试。`native/test_atomic_json.py` 4 项通过；这是 macOS 上的模拟冲突回归，不是 Windows 长视频真实压力测试。需确认报告者助手版本并在 Windows 复测。 |
| [#67 字幕间隔/无时间轴文章](https://github.com/joeseesun/qiaomu-clipper/issues/67) | 已有维护者回复说明字幕间隔部分由 #88 修复；第二项仍应单独跟进。当前已有视频转写作入口，但保留时间链接不等于“导出时可选无时间线”；建议增加导出层开关，不改字幕时间数据。 |
| [#69 编辑时修改 Obsidian 路径](https://github.com/joeseesun/qiaomu-clipper/issues/69) | 当前 `clip-editor.ts` 编辑标题/正文/属性，复用 `createClipBar` 保存；未发现编辑器直接修改目标目录的控件。建议下一轮补保存目标入口，并验证草稿持久化、库/目录切换及实际保存落点；本轮未实现。 |
| [#39 网课笔记/标记/批注](https://github.com/joeseesun/qiaomu-clipper/issues/39) | 拆为“当前句捕获与时间跳转”“视频标记与备份”“网页/PDF 批注恢复”三个验收范围。现有学习笔记和高亮不能证明原请求全部完成；优先核对当前句捕获，再评估跨设备和 PDF 的独立工作量。 |

## 验证证据与边界

- 先把两个 PR 的测试放到旧代码上：17 项中 8 项失败、9 项通过，复现强制滚动及私信插入问题；采用补丁后 17/17 通过。
- 工作流与注入检查器测试 20/20 通过，TypeScript 无错误；旧反馈的字幕语言回归 8/8、原子写入回归 4/4 通过。OpenCode 的提供商与调用回归 33/33 通过。
- Ego Lite 真实浏览器运行当前聊天组件、样式和 `placeWebBar`，仅替换模型、历史存储及扩展 API 为模拟数据。验证发送/流式输出/完成保持阅读位置、点击到底部不重新开启跟随、380px 窄屏按钮可用；按钮实测 32×32px、SVG `mix-blend-mode: normal`，明暗背景不透明。
- 抖音使用两个已知私信容器的本地 DOM 场景：开/关恢复、拒绝任意侧栏、修复旧错误插入、保留未发送草稿均通过。没有访问真实用户私信；真实抖音站点更新后的端到端表现仍待用户复测。
- 固定测试包由 `build:store` 与 `test:prepare` 生成，构建/交付结果放在下方证据目录。文件交付不等于 Chrome 已重载、真实模型已调用或商店已发布。
- 证据目录（不进 Git）：`build/qa/feedback-20261027/`，包括 before/targeted/workflow/types/old-feedback/atomic/opencode 日志、浏览器夹具、结果 JSON、深色及窄屏截图，以及构建与交付日志。
