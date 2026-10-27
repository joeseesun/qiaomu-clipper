# PR 整合与合并决定（2026-10-27）

用户授权：判断哪些直接合并、哪些修改后合并，并执行。工作在干净分支 `codex/integrate-feedback-oct27`，保留贡献者原提交及合并关系；其他工作区的未提交改动不纳入远端提交。扩展版本仍为 1.19.0，此次代码合并不等于商店发布。

## 本轮范围

| PR | 决定 | 处理 |
| --- | --- | --- |
| [#98](https://github.com/joeseesun/qiaomu-clipper/pull/98) | 直接合并 | 保持对话阅读位置，按需回到底部。此前本地验收、本轮精确 head 和 CI 核对完成。 |
| [#102](https://github.com/joeseesun/qiaomu-clipper/pull/102) | 直接合并 | 抖音私信布局与注入检查器路径兼容。此前本地验收、本轮精确 head 和 CI 核对完成。 |
| [#99](https://github.com/joeseesun/qiaomu-clipper/pull/99) | 修改后整合 | 上传/粘贴/拖入附件与网页图片选择、单图提问共存；不接受删除旧网页图片输入路径。验证混合图片请求、失败重试、历史恢复、取消和数量限制。 |
| [#100](https://github.com/joeseesun/qiaomu-clipper/pull/100) | 与历史改造一起整合 | 导航接入 #98 的消息容器；迁移保留用户轮次收藏，不给助手消息误加收藏。更新旧测试中已被 #101 替代的自动淘汰规则，保留顺序和失败恢复验证。 |
| [#101](https://github.com/joeseesun/qiaomu-clipper/pull/101) | 修改后整合 | 合并 IndexedDB 历史、分页、只读浏览、原页面续聊及持久清理任务；快照保留附件、收藏、思考内容。请求只加载最近约 40 条消息的附件，更早消息保留但不重复送入模型；附件缩略图按可见区域加载。 |
| [#97](https://github.com/joeseesun/qiaomu-clipper/pull/97) | 修改后整合 | 保留精确服务地址及模型匹配，未知提供商不切协议；关闭 Qwen 思考时不声明要求思考的代码解释器；原生工具在只读历史不提供重试按钮。保留此前 DeepSeek 翻译关闭思考、批次/并发及限流优化。 |
| [#32](https://github.com/joeseesun/qiaomu-clipper/pull/32) | 暂缓，不原样合并 | 当前字幕优先用户选择、原始语言并记忆每个视频选择；旧全局中文优先策略会改变当前产品规则。 |
| [#33](https://github.com/joeseesun/qiaomu-clipper/pull/33) | 暂缓 | 已吸收部分有维护者记录；剩余浏览器实时识别的音频队列完整性、模型迁移仍需专项修复/验收，不能整包带入。 |
| [#47](https://github.com/joeseesun/qiaomu-clipper/pull/47) | 暂缓 | 已吸收路径/回退等修复有维护者记录；Cookie 授权与持久化、镜像选择、Windows 打包需要拆分，不在此轮更改。 |
| [#103](https://github.com/joeseesun/qiaomu-clipper/pull/103) | 暂缓 | 新第三方预设的服务与模型能力未独立验收，保留自定义兼容入口。 |

没有评论/关闭暂缓条目；此轮不把问题列表清空当成完成标准。旧 issue #69、#67 的新需求仍保留在后续产品工作中。

## 本地验证

- 完整 `npm test`：207 个文件、1711 项通过、7 项跳过；工作流 20 项通过，18 个注入函数完成隔离检查。`tsc --noEmit` 通过。
- 组合回归覆盖：新旧图片同时提交，附件字节不进入历史元数据，上传与停止重试，收藏迁移，顺序保存，写入事务中断无半条记录且后续可重试，删除/清空后的旧窗口不能恢复已删除数据。
- Ego Lite 真实浏览器夹具使用实际 UI、IndexedDB、图片解码、附件与历史存储；扩展 API 和模型请求用合成替身。验证旧收藏/附件迁移与旧键清理、上传后新旧附件分别随所属消息发送、发送时 scrollTop 保持 120、跨页面只读历史和正确来源链接、40 条展开到 64 条、键盘导航和收藏保存。没有操作微信或真实用户私信。
- Token Plan 参数核对依据：[阿里云 Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)、[Token Plan 概述](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)。官方说明部分 Qwen 模型使用代码解释器需要同时开启思考，本轮增加对应回归。API 实际付费调用未重做；原 PR 的真实调用证据属于贡献者验证，不冒充本轮验收。
- 新增能力登记在 `test-delivery.json`。商店构建、固定测试包、远端 CI、PR 合并各自核验，不以一个通过推断其他状态。

本地日志、截图与浏览器夹具保存在 `build/qa/pr-integration/`（不进 Git）。发布后的固定测试包应另外合入此前测试入口已有的未提交功能，保持所有已交付 feature ID；它们不因本轮合并被提交到远端。
