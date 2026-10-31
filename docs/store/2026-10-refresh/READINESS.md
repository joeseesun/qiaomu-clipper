# 1.19.0 商店发布验证

更新时间：2026-10-21。目标版本为扩展 **1.19.0**、本地助手 **1.16.9**。发布状态以对应 GitHub Release 和商店后台为准，本文件记录冻结源码前的验收边界。

## 已处理的问题

- 完整卸载与单个识别引擎卸载均只清理助手独立环境，保留共享 Hugging Face 模型缓存。旧客户端传入 `model=true` 也不会删除共享模型；新扩展会拦截不具备安全卸载能力的旧助手。
- 卸载测试按 macOS、Linux 和 Windows 分别构造路径与管理员预期，Windows 注册表使用隔离替身；三平台 CI 均运行卸载回归。
- Codex 生图事件同时带回内嵌图片与全局保存路径时，优先使用图片字节，不读取工作目录外的路径；仍拒绝只有越界文件路径的结果。
- 更新商店中英文介绍、五张截图、两张宣传图及隐私说明。图中 AI 回复和内容明确标为示例。

## 验证记录

- 前端：193 个文件，1,620 项通过、7 项跳过；TypeScript 通过；商店下载策略 60 项通过、2 项跳过；翻译检查 110 项通过。
- 本地助手：最终全量 235 项通过，包含 5 项 Codex 回归。三平台卸载 CI 通过，详见发布 PR。
- 助手 1.16.9 完成 Developer ID 签名、公证与装订，Gatekeeper 验证通过；安装包模块与源码一致，隔离安装自检通过。未在用户系统中升级助手。
- 真实 Search 请求返回 6 条来源，Fetch 返回 931 字符正文。Chrome 某个文档 URL 的 Fetch 返回 404，换公开来源成功；没有改写或绕过服务限制。
- Codex 真实调用发现 `codex-image-path-invalid`，已按实际 app-server 事件修复。复验生成 1,063,638 字节 PNG，经三次原生消息分块读取完整，见 `evidence/codex-live.json`。图像已目视检查，仅用于功能验证，不是商店 Logo 或宣传素材。
- Ego Lite 刷新后确认商店正式包为 1.18.8、没有待审版本。浏览器旧页面最初显示 1.18.7 待审，不能作为当前状态。

## 交付与未验证边界

正式构建、固定测试入口、签名公证助手、GitHub 合并发布和商店提交须取得各自证据。固定入口始终是 `~/Documents/乔木剪藏测试/extension`。已安装助手在本轮开始时为 1.16.7，不把源码 1.16.9 当作已安装。

本轮尚未完成固定入口的 Chrome 实际重载、所有模型供应商逐一出图、关闭实际侧栏后恢复、Windows/Intel 真机识别及各发布平台草稿写入。真实服务调用、组件演示与自动回归不能代替上述实机操作；Firefox/Safari 以构建验证为限。

## 开发进度

| 范围 | 结论 |
| --- | --- |
| 阅读、剪藏、图片问答、X 图文/视频识别、写作与发布桥 | 已在主线或本次集成基线中；X 无视频文章识别修复可追溯 PR #88 |
| 即梦、生图侧栏、后台任务、独立图库、本机 Codex、Unsplash、联网搜索 | 已入 PR #95；本机 Codex 与联网搜索真实调用通过，其余账号及侧栏恢复验收缺口见上文 |
| 模型选择、思考强度、引用预览、联网图标、AI 魔法棒、写文章入口、写作滚动修复 | 最新开发聊天、集成源码及固定入口身份一致 |
| [PR #94 字幕格式](https://github.com/joeseesun/qiaomu-clipper/pull/94) | 已包含于 #95，无需重复合入 |
| [PR #32 中文字幕优先](https://github.com/joeseesun/qiaomu-clipper/pull/32) | 与当前原音轨和用户选择策略冲突，不宜整包合并 |
| [PR #33 浏览器 Whisper](https://github.com/joeseesun/qiaomu-clipper/pull/33) | 部分布局、导出及端点修复已吸收；剩余实现应独立处理 |
| [PR #47 Windows](https://github.com/joeseesun/qiaomu-clipper/pull/47) | 部分修复已吸收；旧下载回调及打包目录存在冲突，不宜整包合并 |
| 旧写作图库分支 | 与已交付图库重叠的替代实现未整体合入，保留归档 |
| [#69 编辑保存路径](https://github.com/joeseesun/qiaomu-clipper/issues/69)、[#67 无时间戳文章](https://github.com/joeseesun/qiaomu-clipper/issues/67)、[#39 学习建议](https://github.com/joeseesun/qiaomu-clipper/issues/39) | 仍有开放需求；不把开放状态等同于发布故障，也不宣称已全部交付 |
| [#62 Windows 状态文件](https://github.com/joeseesun/qiaomu-clipper/issues/62)、[#41 OpenCode](https://github.com/joeseesun/qiaomu-clipper/issues/41) | 当前已有代码修复与回归，Windows 真实长任务验收仍未补齐 |


## 初始检查与来源

[初始检查](evidence/initial-readiness.md)保留修复前的失败结论与日志；它不是当前发布结论。集成基线为 PR #95 / `37cc07a3`，包含 PR #94，保留原固定包 43 项功能并补充安全卸载交付项。原旧 checkout 及其他线程未提交文件保持不变。
