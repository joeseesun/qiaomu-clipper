# Codex 原生网页对话助手

该助手通过 Native Messaging 连接本机官方 `codex app-server`，让网页对话和写作 AI 使用真实的搜索、网页读取、页内查找与官方线程接续。账号、模型和思考强度仍由用户选择，助手逐轮核对，不自动换账号、模型或旧文字通道。

## 当前支持范围

- 安装器适配 **macOS Chrome / SunBrowser**；Windows、Linux 安装与其他浏览器尚未交付。
- 要求已安装并登录的 **Codex CLI 0.162.1**、本机已生成的模型目录，以及可用的 Python 3。
- 扩展选择的 Codex 账号必须与本机 Codex 的 ChatGPT 登录账号一致。升级后，使用该原生聊天路径的 Codex 账号需要安装此独立助手；只更新扩展并不足以启用它。其他供应商聊天保持原路径。
- CLI 版本不匹配、账号不一致、模型或档位无权限时明确报错。CLI 升级后需先重新核定工具注册范围并更新助手，不能只去掉版本检查。

## 安装

先执行 `codex --version`，确认结果为 `codex-cli 0.162.1`。在扩展管理页复制实际扩展 ID，然后从仓库根目录运行（将占位符替换为实际值）：

```sh
python3 native/install_codex_chat.py --extension-id EXTENSION_ID
```

这会注册 `ai.qiaomu.clipper.codex_chat`，安装到当前用户的 `~/.local/share/qiaomu-clipper-codex-chat/host/`。它与原有 `ai.qiaomu.clipper` 剪藏/媒体助手分开，不会替换后者。

SunBrowser 隔离环境应显式提供该环境的实际用户数据目录：

```sh
python3 native/install_codex_chat.py --extension-id EXTENSION_ID --browser-user-data /absolute/path/to/profile
```

安装器只为指定目录登记，不遍历更新其他环境。重新运行可更新代码。当前安装器每次登记一个扩展 ID；若要切换商店版/本地加载版，应使用当前实际 ID 重新登记。

GUI 原生进程通常不继承终端代理。安装器在安装环境设置了代理时，将这些代理环境变量保存到权限为 `0600` 的本地 `network.json`，供助手启动时使用；不会修改浏览器或系统网络设置。该文件可能含本地代理凭据，不应随源码或问题报告上传。

## 使用与会话

选择已接入本机 Codex 的模型及思考强度，开启联网后正常提问。工具卡根据真实事件显示搜索、网页读取、页内查找、来源及完成/失败/中断状态。服务进度与最终回答分别处理；不再使用旧代理循环的固定搜索/读取次数上限，写作面板也不再因原生长思考静默超过 120 秒而提前取消。用户停止仍会中断当前轮。

相同浏览器命名空间、会话和账号映射到官方线程。正常追问通过 `thread/resume` 续接，只发送新增输入；旧对话首次进入原生通道时导入已有文字。用户消息前缀变化或上一轮未完成时创建新线程，不伪造历史工具执行记录。模型的上下文上限、自动整理和服务额度继续生效。

浏览器历史与官方线程分别存储：删除浏览器对话不会删除官方线程。连接意外断开时界面显示错误；检查登录、版本及安装后手动重试，不会静默改用另一账号或模型。

## 工具与数据边界

新通道只向助手传递对话输入、账号邮箱、模型/档位和会话标识，不从浏览器传递 OAuth access/refresh token。登录和刷新由本机 Codex 管理。

助手使用进程级配置与专用模型目录，禁用终端、文件修改、电脑控制、图片生成、MCP、插件、技能与子代理能力；只保留网页相关能力及必要的运行编排。不会修改全局 Codex 配置。原生助手本身仍需读写本地会话映射和调用 Codex 的线程存储，这不同于向模型开放本机文件工具。

## 检查

```sh
python3 -m unittest discover -s native -p 'test_*.py'
npx vitest run src/utils/codex-chat.test.ts src/utils/codex-chat-stream.test.ts src/utils/chat-agent.test.ts src/write/ai/chat-panel.test.ts
```

原生测试使用隔离的模拟运行时，不消耗真实模型额度。POSIX 管道/子进程用例在 Windows 明确跳过；跳过不表示 Windows 支持。真实运行证据与范围见[验证说明](../docs/verification/codex-native-chat/README.md)。
