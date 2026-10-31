# 1.18.6 集成与发布核对

更新时间：2026-10-16。集成基线 483f749，包含 origin/main 9ae1382 及固定入口已安装提交。保留所有来源工作区。

- 23 项交付功能来自 test-delivery.json；包括新视频号学习和独立版 YouTube 下载。
- channels-helper e2e254d、local-youtube-download 1d85ee5 已包含；随后追加学习页后台解析、下载入口、MP4 优先与匿名读取修复。
- 主工作区、player-chinese-captions、captions-stable-delivery、doubao-karaoke、study-playback-handoff、study-test-integration、subtitle-edit-controls 的旧草稿按既有 STUDY-INTEGRATION-2026-10-13.md 逐项核对，现有字幕、模型恢复、存储和交付功能保留，不用旧文件覆盖新版。
- editions 工作区的版本指南已包含，并按独立版新增 YouTube 下载修订。learning-ui 的设置/学习按钮顺序已在当前 reader-preview-shell.ts 中。learning-core 日记追加和对话框快捷键保护、旧 error-153 规则已有对应实现。
- halibut 的 package-lock 仅缩进变化，解析 JSON 与其 HEAD 完全一致，不引入无关改动。旧 PR #32/#33/#47 的字幕、学习布局、Windows 修复已被后续实现覆盖，沿用现有来源与下载安全校验。
- 修复两版检查新增 allowYoutube 后未同步的打包夹具，并增加商店泄漏/独立版缺失的反例测试。
- 更新下载、Cookie、分轨合并和元宝解析隐私说明。商店审核材料中旧版状态保留为历史记录。

验证：干净 npm ci；前端 1337 通过/7 跳过；助手 225 通过；TypeScript、九语言 110、商店策略 60 通过/2 条独立版用例跳过。最终构建、签名公证、GitHub 与商店状态以本次发布的外部回执为准。真实微信客户端不自动操作；视频号完整实机流程未在本次重新验收。
