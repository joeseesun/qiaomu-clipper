# 2026-10-21 商店发布检查

**结论：主要功能已集成，但目前不能直接合并发布。** 先修复卸载模型缓存的删除范围与 Linux CI，再冻结新版本、完成真实服务验收和助手安装包发布。建议版本号为 **1.19.0**；本轮没有递增版本、合并、推送或提交商店。

## 当前版本与范围

| 位置 | 本轮核实结果 |
| --- | --- |
| [公开 Chrome 商店](https://chromewebstore.google.com/detail/jniolfihillilkoajpnonlbkhfkiicoo) | 1.18.8，页面更新日期 2026-10-20 |
| [GitHub 最新 Release](https://github.com/joeseesun/qiaomu-clipper/releases/tag/1.18.9) | 1.18.9；助手资产仍为 1.16.6 |
| `origin/main` | `7029136b` |
| [集成 PR #95](https://github.com/joeseesun/qiaomu-clipper/pull/95) | `37cc07a3`；143 个变更文件；可合并但检查失败 |
| 固定测试入口 `CURRENT.json` | 1.18.9 / `37cc07a3` / clean，43 项功能；与集成候选一致 |
| 集成源码 `native/VERSION` | 1.16.8，不能把旧 1.16.6 安装包当作本轮助手交付 |
| 原 checkout | `main` 的旧提交 `ddb4a7a7`，落后 82 个提交、79 项未提交文件；保留原样 |
| 本轮商店材料 | `codex/store-refresh-oct21`，以 `37cc07a3` 建立的隔离工作区，尚未提交 |

本轮核对了 Git、11 个既有 worktree、5 个开放 PR、5 个开放 issue、近期相关聊天及已有集成记录。`worktree-audit.json` 记录未提交文件与集成版的字节差异；这不是对每份旧 diff 的语义完整性证明。尚不能声称所有历史需求都已完成。

## 开发进度

| 范围 | 结论 |
| --- | --- |
| 阅读、剪藏、图片问答、X 图文/视频识别、写作与发布桥 | 已在主线或本次集成基线中；X 无视频文章识别修复可追溯 PR #88 |
| 即梦、生图侧栏、后台任务、独立图库、本机 Codex、Unsplash、联网搜索 | 已入 PR #95；真实账号验收缺口仍在 |
| 模型选择、思考强度、引用预览、联网图标、AI 魔法棒、写文章入口、写作滚动修复 | 最新开发聊天、集成源码及固定入口身份一致 |
| [PR #94 字幕格式](https://github.com/joeseesun/qiaomu-clipper/pull/94) | 已包含于 #95，无需重复合入 |
| [PR #32 中文字幕优先](https://github.com/joeseesun/qiaomu-clipper/pull/32) | 与当前原音轨和用户选择策略冲突，不宜整包合并 |
| [PR #33 浏览器 Whisper](https://github.com/joeseesun/qiaomu-clipper/pull/33) | 部分布局、导出及端点修复已吸收；剩余实现应独立处理 |
| [PR #47 Windows](https://github.com/joeseesun/qiaomu-clipper/pull/47) | 部分修复已吸收；旧下载回调及打包目录存在冲突，不宜整包合并 |
| 旧写作图库分支 | 与已交付图库重叠的替代实现未整体合入，保留归档 |
| [#69 编辑保存路径](https://github.com/joeseesun/qiaomu-clipper/issues/69)、[#67 无时间戳文章](https://github.com/joeseesun/qiaomu-clipper/issues/67)、[#39 学习建议](https://github.com/joeseesun/qiaomu-clipper/issues/39) | 仍有开放需求；不把开放状态等同于发布故障，也不宣称已全部交付 |
| [#62 Windows 状态文件](https://github.com/joeseesun/qiaomu-clipper/issues/62)、[#41 OpenCode](https://github.com/joeseesun/qiaomu-clipper/issues/41) | 当前已有代码修复与回归，Windows 真实长任务验收仍未补齐 |

## 发布阻碍

### P1：卸载可能删除其他工具共用的模型

`native/asr_engines.py:14-15` 的 `hf_home()` 默认指向 `~/.cache/huggingface`；`native/uninstall.py:38-44` 按支持的引擎模型名称枚举该共享缓存，没有“由本助手安装”的归属记录。`plan():49` 把已有目录纳入计划，`remove_user():81` 会递归删除。因此注释中的“不碰其他工具下载的模型”没有得到实现保证。

本轮只在临时 `HF_HOME` 中放置同名模型和其他工具标记，调用读取函数：模型被纳入候选，标记仍在，未执行卸载。建议默认保留共享模型；只有助手专属目录且归属可验证时才清理。回归需证明共享目录、符号链接和无归属记录目录保持完整。

### P1：两个远端检查失败

- [verify](https://github.com/joeseesun/qiaomu-clipper/actions/runs/39463704104/job/118769419071)
- [install / Ubuntu](https://github.com/joeseesun/qiaomu-clipper/actions/runs/39463704168/job/118769420742)

两者均在 `native/test_uninstall.py:32` 失败：fixture 固定创建 macOS 的 `Library/Application Support`，Linux 实现读取 `~/.config`，返回空列表；后续 `needsAdmin` 断言也固定假设 macOS。应按平台构造与断言，并保留实际卸载安全测试。不能用本机 macOS 全绿替代 Linux。

### 发布前还需完成

1. 新版本号大于已发布的 1.18.9；更新变更说明、构建身份和相关清单。
2. 发布与源码匹配的助手安装包：签名、公证、安装验证以及下载资产校验；新模块不能只存在于本机源码。
3. 在固定测试入口重载最终构建，真实运行普通网页与视频、写作导入导出、真实生图及关闭面板后恢复、真实联网/图片搜索。按实际接入使用自有服务；成功模型列表不等于成功出图。
4. 对 X/其他平台草稿流程分别确认支持范围，禁止把模拟回复和模拟编辑器当作真实提交证据。
5. 核对商店后台的草稿/待审状态，上传新扩展包及本目录素材，发布隐私文档后再送审。此前相关聊天记录过后台访问被工具拒绝，本轮未重试该后台操作；当前待审状态未知。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| `git fetch origin` + `npm run check:dev-base` | 通过 |
| `TZ=America/Los_Angeles npm test` | 193 文件；1619 通过、7 跳过；工作流 19 项、注入 18 个函数检查通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run check:i18n` | 110 项通过 |
| macOS `python3 -m unittest discover -s native -p 'test_*.py'` | 232 项通过 |
| 远端 extension、macOS install、Windows install | 通过；不代表 Windows 真机长时间识别完成 |
| 远端 verify、Ubuntu install | 失败，见上文 |
| 宣传图 | 7 张浏览器导出，逐张检查，无水平溢出；实际组件 + 明示的示例内容 |

自动检查日志在集成工作区 `build/qa/release-readiness/`。本目录 `evidence/` 保存本轮摘要和失败日志。本轮没有重新构建发布 ZIP、替换测试入口、发起真实外部生图或修改商店。

检查时点与来源：2026-10-21，GitHub CLI/API、公开商店页面、当前源码、固定入口 `CURRENT.json`、测试日志及相关聊天。未来提交变化后需重新检查对应项。
