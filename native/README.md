# 本地静默剪藏助手

Chrome 扩展通过 Native Messaging 按需调用助手，直接保存 Markdown 到指定 Obsidian 库，不使用 obsidian://、剪贴板或网络端口，也不唤起 Obsidian。

安装（macOS / Linux Chrome）：

```sh
python3 native/install.py --vault /absolute/path/to/vault --extension-id YOUR_CHROME_EXTENSION_ID
```

重新构建并在 Chrome 扩展管理页重新加载扩展。弹窗提供目标库与相对笔记位置选择，主按钮改为“剪藏”。一次点击保存本地笔记，并按原有勾选状态提交 RSS；两处结果分开显示。助手已配置但不可用时保留本地待保存内容和重试按钮，不自动跳转 Obsidian。

切换库：扩展设置 → 常规 → 仓库 → “静默保存的笔记库地址”，点击“选择文件夹”，选择自己的 Obsidian 库根目录，然后点击“保存库地址”。也支持手动填写完整路径。macOS 使用系统文件夹选择器，Linux 需要可用的 Tkinter 图形环境，否则手动填写。助手验证目录包含 `.obsidian` 后持久保存地址，扩展同步添加实际文件夹名并将其设为下次选择。重新打开剪藏弹窗；之前因库名不一致失败的笔记可直接重试。只在库名列表添加 `rockfish` 不会更改助手的磁盘目标。每台电脑的地址单独配置，不随扩展同步到其他电脑；取消选择不更改原目标。

助手只接受安装时配置的扩展来源，只能保存所选库内的 Markdown，拒绝路径越界、隐藏配置文件和跨库请求。新建笔记遇到同名文件会使用数字后缀；支持模板的追加、前置、覆盖行为。已有请求重复提交不会重复写笔记。

日记使用电脑真实日期和该库 `.obsidian/daily-notes.json` 的目录配置；支持常见数字日期格式。复杂日期格式或已配置日记模板时明确报错，可通过更多菜单“添加到 Obsidian”保留原始行为。

助手安装文件位于 `~/.local/share/qiaomu-clipper/`，Chrome 注册文件位于用户级 `NativeMessagingHosts/ai.qiaomu.clipper.json`。助手不常驻。卸载时移除注册文件即可停用连接；如需恢复 URI 保存，可清除扩展本地存储的 `qiaomuNativeConfigured` 标记。不要清除全部扩展存储，以免丢失模板和待提交内容。

测试：`python3 -m unittest discover -s native -p 'test_*.py'`。

协议依据：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。

模板的“笔记位置”右侧提供文件夹图标，通过本地助手浏览当前配置库内的文件夹，选择后填入库内相对路径并按模板原有机制自动保存。取消不修改路径；库外、隐藏配置目录及指向库外的符号链接均会被拒绝。模板指定了不同的库时，先在常规设置切换本地助手目标；未安装助手时可继续手动输入路径与模板变量。

## 学习笔记（追加到今天的日记）

同一个助手也负责「学习笔记」：扩展先问助手今天的日记在哪（`learningDailyTarget`），你确认后再追加内容（`saveLearning`）。

- **日记位置**：读取库里 `.obsidian/daily-notes.json` 的目录和日期格式，用电脑真实日期解析。只支持数字日期（如 `YYYY-MM-DD`、`YYYY/MM/DD`）且未配置模板；否则返回明确原因，不会猜路径。
- **只追加**：不改动 frontmatter 和已有正文，每条笔记自带标记注释，同一条重试不会重复写入，崩溃后可凭回执恢复，跨午夜会要求重新确认目标。
- **升级后要重装**：学习笔记需要新版助手，升级扩展后请重新运行安装命令（会覆盖 `~/.local/share/qiaomu-clipper/host.py`，库路径和扩展来源沿用你给的参数）。

找到自己的扩展 ID：打开 `chrome://extensions`，开启右上角「开发者模式」，复制「乔木剪藏」卡片上的 ID（32 个字母）。从应用商店安装与本地加载的 ID 不同，助手只接受安装时给出的那一个。

```sh
python3 native/install.py --vault /绝对路径/你的库 --extension-id 你的扩展ID
```

不想让助手碰你的日记时，在扩展设置里关闭「学习笔记」即可。
