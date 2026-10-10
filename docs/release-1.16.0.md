## 中文

### 新增与修复
- 支持视频号分享链接和小鹅通已结束直播回放的字幕学习；播放器、字幕编辑及阅读往返保留播放位置与修改。
- 修复恢复草稿、多个标签和过期媒体之间的文字覆盖；复制或下载可以保留未保存的当前编辑。YouTube／B 站编辑后返回阅读继续显示修改稿。
- 小鹅通的嵌套清单、片段和密钥统一经过受限下载，包括无扩展名清单；不保存签名媒体地址，不绕过登录或课程权限。
- 修复 Windows 读取 state.json 时与原子替换冲突的 WinError 5；本地文件学习避免重复生成字幕，支持换模型重做。
- 增加 OpenCode Go：对话恢复后保持会话身份，新对话独立；仅列出当前已支持的聊天模型。
- RSS 同步过期时可重新连接并重试，不需要关闭编辑页。

### 验证与边界
完整前端及助手测试、类型检查、四个扩展构建和跨平台 CI 通过。浏览器验收使用合成页面／媒体和模拟识别；真实视频号登录、付费课程、OpenCode 订阅推理及用户实机安装未实测。Firefox／Safari 完成构建，未完成实机验收。OpenCode Go 暂限 Chat Completions，其他协议模型不发送请求。

### 升级
macOS 请安装本版本已签名公证的助手安装包，再更新扩展；Windows／Linux 按 native/README.md 更新助手代码。先备份设置、保留现有数据。GitHub 本地版使用 chrome-local.zip；chrome.zip 供商店提交，本次没有提交商店或新增发布渠道。

感谢 @Averyzhang761（#58／#59）、@StaySound4（#43）和 @longpeng1413（#57）的贡献。

## English

### Added and fixed
- Added subtitle study for WeChat Channels share links and completed Xiaoetong live replays. Reading/editing transitions preserve playback position and edited captions.
- Fixed draft overwrites across recovered tabs, concurrent edits and expired media. Copy/download rescue current unsaved text. Edited YouTube/Bilibili transcripts remain visible when returning to reading.
- Guarded all nested Xiaoetong playlists, fragments and keys, including extensionless playlists. Signed media URLs are not persisted; login and course access controls remain required.
- Fixed Windows state.json replacement conflicts (WinError 5). Local-file study avoids duplicate recognition and supports regenerating with another model.
- Added OpenCode Go with persistent conversation sessions, isolated new conversations and compatible chat-model selection.
- Expired RSS connections can be reconnected and retried without closing the editor.

### Verification and limits
Full extension/native tests, TypeScript, all four extension builds and cross-platform CI passed. Browser checks use synthetic websites/media and mocked recognition. Real Channels accounts, paid courses, OpenCode subscription inference and installation on the user's device were not tested. Firefox/Safari builds passed without device acceptance. OpenCode Go supports Chat Completions only; unsupported protocol models are rejected before inference.

### Upgrade
Install this release's signed, notarized macOS helper and update the extension. Windows/Linux users should update helper source following native/README.md. Back up settings and preserve existing data. Use chrome-local.zip for GitHub installation; chrome.zip is the store package. This release does not submit to extension stores or add a distribution channel.

Thanks to @Averyzhang761 (#58/#59), @StaySound4 (#43) and @longpeng1413 (#57).
