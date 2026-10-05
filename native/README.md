# 本地静默剪藏助手

Chrome 扩展通过 Native Messaging 按需调用助手，直接保存 Markdown 到指定 Obsidian 库，不使用 obsidian://、剪贴板或网络端口，也不唤起 Obsidian。

安装（macOS / Linux，Chrome / Edge / Brave / Vivaldi / Chromium / Arc）：先在浏览器里装好扩展，然后无需任何参数：

```sh
python3 native/install.py
```

安装器会自动找到浏览器里的「乔木剪藏」扩展 ID（商店版与本地加载版都会识别，同时存在则都放行）和 Obsidian 库（读取 Obsidian 的库列表；有多个库时会列出并要求用 `--vault` 指定），为每个检测到的浏览器注册，最后用真实的 Native Messaging 协议自检，输出 JSON，`ok: true` 才算装好。需要 Python 3.9+。

遇到「本地保存助手未连接」，先诊断（不改任何文件）：

```sh
python3 native/install.py --check
```

输出 `problems` 会指出原因：未注册、扩展 ID 不在允许列表（商店版与本地加载版 ID 不同）、库路径失效等。多数情况重新运行安装命令即可修复。

### 让 AI agent 代装

把下面这句话发给 Claude Code / Codex 等 agent（它需要在你的电脑上有终端权限）：

> 帮我安装乔木剪藏的本地保存助手：克隆 https://github.com/joeseesun/qiaomu-clipper ，在仓库里运行 `python3 native/install.py`，不要手动编造扩展 ID 或库路径。输出 `ok: false` 时读 `error` 和 `hint` 处理；如果列出了多个库，问我用哪个；成功后运行 `python3 native/install.py --check` 确认，并告诉我去 chrome://extensions 重新加载扩展。

agent 注意：不要猜扩展 ID（商店版与本地加载版不同，猜错就是「未连接」的头号原因）；浏览器没装扩展时先让用户装；安装后不需要重启浏览器，只需重新加载扩展。手动指定仍可用：`--vault /绝对路径 --extension-id 扩展ID`（`--extension-id` 可重复）。

重新构建并在 Chrome 扩展管理页重新加载扩展。弹窗提供目标库与相对笔记位置选择，主按钮改为“剪藏”。一次点击保存本地笔记，并按原有勾选状态提交 RSS；两处结果分开显示。助手已配置但不可用时保留本地待保存内容和重试按钮，不自动跳转 Obsidian。

切换库：扩展设置 → 常规 → 仓库 → “静默保存的笔记库地址”，点击“选择文件夹”，选择自己的 Obsidian 库根目录，然后点击“保存库地址”。也支持手动填写完整路径。macOS 使用系统文件夹选择器，Linux 需要可用的 Tkinter 图形环境，否则手动填写。助手验证目录包含 `.obsidian` 后持久保存地址，扩展同步添加实际文件夹名并将其设为下次选择。重新打开剪藏弹窗；之前因库名不一致失败的笔记可直接重试。只在库名列表添加 `rockfish` 不会更改助手的磁盘目标。每台电脑的地址单独配置，不随扩展同步到其他电脑；取消选择不更改原目标。

助手只接受安装时配置的扩展来源，只能保存所选库内的 Markdown，拒绝路径越界、隐藏配置文件和跨库请求。新建笔记遇到同名文件会使用数字后缀；支持模板的追加、前置、覆盖行为。已有请求重复提交不会重复写笔记。

日记使用电脑真实日期和该库 `.obsidian/daily-notes.json` 的目录配置；支持常见数字日期格式。复杂日期格式或已配置日记模板时明确报错，可通过更多菜单“添加到 Obsidian”保留原始行为。

助手安装文件位于 `~/.local/share/qiaomu-clipper/`，Chrome 注册文件位于用户级 `NativeMessagingHosts/ai.qiaomu.clipper.json`。助手不常驻（只有「生成字幕」任务运行期间，会有一个后台识别进程，结束即退出）。卸载时移除注册文件即可停用连接；如需恢复 URI 保存，可清除扩展本地存储的 `qiaomuNativeConfigured` 标记。不要清除全部扩展存储，以免丢失模板和待提交内容。

测试：`python3 -m unittest discover -s native -p 'test_*.py'`。

协议依据：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。

模板的“笔记位置”右侧提供文件夹图标，通过本地助手浏览当前配置库内的文件夹，选择后填入库内相对路径并按模板原有机制自动保存。取消不修改路径；库外、隐藏配置目录及指向库外的符号链接均会被拒绝。模板指定了不同的库时，先在常规设置切换本地助手目标；未安装助手时可继续手动输入路径与模板变量。

## 学习笔记（追加到今天的日记）

同一个助手也负责「学习笔记」：扩展先问助手今天的日记在哪（`learningDailyTarget`），你确认后再追加内容（`saveLearning`）。

- **日记位置**：读取库里 `.obsidian/daily-notes.json` 的目录和日期格式，用电脑真实日期解析。只支持数字日期（如 `YYYY-MM-DD`、`YYYY/MM/DD`）且未配置模板；否则返回明确原因，不会猜路径。
- **只追加**：不改动 frontmatter 和已有正文，日记里不留任何标记；同一条重试靠助手本地的回执（写入前日记的哈希与长度）判断是否已写入，不会重复，崩溃后同样凭回执恢复，跨午夜会要求重新确认目标。
- **升级后要重装**：学习笔记需要新版助手，升级扩展后请重新运行 `python3 native/install.py`（会覆盖 `~/.local/share/qiaomu-clipper/host.py`，库路径和扩展来源沿用你给的参数）。

自动检测失败时手动找扩展 ID：打开 `chrome://extensions`，开启右上角「开发者模式」，复制「乔木剪藏」卡片上的 ID（32 个字母）。从应用商店安装与本地加载的 ID 不同，助手只接受安装时给出的 ID，两种都在用就都传。

不想让助手碰你的日记时，在扩展设置里关闭「学习笔记」即可。

## 无字幕视频：本机生成字幕

字幕条里的「生成字幕」由助手里的 `asr.py` 完成：`yt-dlp` 下载音频 → `ffmpeg` 转 16 kHz 单声道 → Whisper 识别，字幕边出边显示。不监听端口：扩展用现有的一次性原生消息启动一个后台任务，再每秒读一次进度文件。

### 自动安装（默认）

不需要手动装任何东西：在字幕条里选了还没安装的本机引擎，或在设置里点「下载并安装」，助手会自己装好再继续，界面写明大小并显示进度，可以取消，也可以在设置里卸载。每个引擎有自己独立的 Python 虚拟环境（两个引擎要的库版本会冲突），全部放在 `~/.local/share/qiaomu-clipper/tools/`，不碰系统环境，也不需要 Homebrew：

| 引擎 | 平台 | 大小 | 说明 |
|---|---|---|---|
| `mlx`：Whisper large-v3-turbo（mlx-whisper） | Apple 芯片 | 约 1.7 GB | 最快，41 分钟约 1 分钟 |
| `mlx-qwen3`：Qwen3-ASR 0.6B（mlx-qwen3-asr） | Apple 芯片 | 约 1.3 GB | 中文术语准确，41 分钟约 84 秒 |
| `faster-whisper`：Whisper large-v3-turbo | 任何电脑，CPU 即可 | 约 1.7 GB | 较慢，41 分钟约 10 分钟 |
| `base`：yt-dlp + 随包 ffmpeg（imageio-ffmpeg） | 全部 | 约 60 MB | 下载和切音频；没有系统 ffmpeg 时自动装 |

- 动作：`asrInstall`（`engine` 只能是上表里的 id，页面不能指定任意包）、`asrInstallPoll`、`asrInstallCancel`、`asrUninstall`（只在设置页可用）。安装前检查磁盘空间；失败或取消会清掉装了一半的环境；安装期间不能同时跑识别任务。
- 随包 ffmpeg 没有 ffprobe，音频长度由 `ffmpeg -i` 的 `Duration:` 读出。
- `asr_runner.py` 在引擎自己的环境里运行，逐句打印 `[开始 --> 结束] 文字`，和 mlx-whisper 的输出一样，所以任务逻辑对所有引擎相同。Qwen3-ASR 只返回文字，所以先按停顿切块，再把句子放回时间轴（和云端一样）。
- `QIAOMU_TOOLS_HOME` 可改工具目录；已经用 Homebrew / `uv tool` 装好的 `yt-dlp`、`ffmpeg`、`mlx_whisper` 仍然会被直接使用，不会重复安装。

### 手动安装（可选）

```sh
brew install yt-dlp ffmpeg
uv tool install mlx-whisper      # Apple 芯片，首次使用下载约 1.6 GB 的 large-v3-turbo 模型
```

没有 Apple 芯片时也可以用 whisper.cpp：安装 `whisper-cli`，并把 ggml 模型放在 `~/.cache/whisper.cpp/` 或用环境变量 `WHISPER_CPP_MODEL` 指定。`python3 native/install.py --check` 的 `subtitleGeneration` 一项会列出缺少什么。

- 来源（`videoKey` 只能是这几种，地址都由助手自己拼）：`youtube:<11位ID>`、`bilibili:BV…:<分P>`、`xiaoyuzhou:<24位十六进制节目ID>`（读节目页的 `og:audio`，只接受 `*.xyzcdn.net` 的 https 地址，用 urllib 下载，不经 yt-dlp）、`file:<32位十六进制>`（用户选的本地文件，见下）。
- 其他网站：`web:<地址哈希12位>`，请求里带 `web: {url}`，助手核对哈希并要求公开 https 地址，交给 yt-dlp 下载（也复用同一套背景信息：标题、作者、简介）；`asrProbe {url}` 先用 `yt-dlp --dump-single-json` 看一眼：能不能读、是什么、有没有可以直接播放的声音地址（HLS 等流不提供播放器）。只有扩展自己的页面能发这两种请求。设置里可以逐个网站关闭，默认全部打开。
- 播客订阅源：`rss:<订阅源哈希12位>:<节目哈希16位>`，请求里带 `rss: {feed, guid}`，助手核对两个哈希、要求 https 的真实域名（不解析域名，以免挡住自带 DNS 的代理用户；数字 IP、localhost、.local 等都拒绝，跳转也逐跳检查），只读订阅源开头约 6 MB（最新的在前），按 guid 找到那一集的音频地址下载；标题、节目名和简介作为识别的背景。只有扩展自己的页面能发这种请求。
- 本地文件：只有扩展自己的页面能交文件给助手。`asrUploadStart`（文件名后缀必须是常见音视频格式，大小不超过 4 GB，检查磁盘空间）→ 按 4 MB 分块 `asrUploadChunk`（base64，顺序和大小逐块校验）→ `asrUploadFinish`，助手算出内容的 sha256 前 32 位作为 `file:` 键，文件存在 `asr/uploads/<键>/`，同一个文件不会重复转写（结果缓存命中）。任务开始时复制成 `audio.src.<后缀>` 再转码，任务结束删除副本；原件保留 3 天后清理。
- 动作：`asrStatus`（带 `engine` 时检查该引擎，并列出所有本机引擎和可安装项）、`asrStart`（`engine` 选引擎）（只接受 `youtube:<11位ID>` 或 `bilibili:BV…:<分P>`，地址由助手自己拼）、`asrPoll`、`asrCancel`。一次只跑一个任务；同一视频再次请求直接读缓存。
- 数据：任务目录与结果缓存在 `~/.local/share/qiaomu-clipper/asr/`；音频在任务结束时删除，任务目录保留 3 天，结果缓存保留 60 天。
- YouTube 经常要求登录状态才允许下载音频（出口是数据中心 IP 时尤其如此，PO Token 解决不了）：任务会以 `needs-cookies` 失败，只有用户在界面上明确同意后，才会带 `--cookies-from-browser <浏览器>` 重试。yt-dlp 官方提醒：用账号下载有被限制甚至封禁的风险，请少量使用。
- 实测（Apple M5 Pro，B 站 41 分钟中文课程）：下载 4 秒，转码 1 秒，识别 62 秒，约 40 倍速。

### 用视频信息提高人名和术语的准确度

`asr_context.py` 把页面上的标题、作者、简介、章节（YouTube 和 B 站来自 yt-dlp 的 info json，小宇宙来自节目页）按规则清洗（去网址、时间戳、表情、话题符号、关注/订阅/广告类整行），按模型的容量裁剪后作为背景交给识别，不用任何模型整理，也不按节目人工整理。实测（一集嘉宾叫「曾鸣」的节目）：不带背景时 Whisper 写成「曾敏」、Qwen3-ASR 写成「曾明」，带上简介后都写对；豆包也纠正了主持人的名字。

| 识别方式 | 怎么带 | 状态 |
|---|---|---|
| 本机 Qwen3-ASR | 系统提示里的 `context`（约 1200 字） | 已验证 |
| 本机 Whisper（mlx / faster-whisper） | `initial_prompt`，只留末尾约 160 字，重要的在最后 | 已验证（mlx） |
| 豆包 | `request.corpus.context`（JSON，约 700 字） | 已验证 |
| OpenAI、Groq | `prompt`（约 160 字） | 按公开接口接入，未实测 |
| 硅基流动、智谱、阶跃 | 不带：实测接受但结果没有变化 | — |
| 小米 MiMo | 不带：服务拒绝多余的文字 | — |

背景语言与语音语言不一致时（如中文背景配英文音频）不带。设置里可以关闭（「用视频信息提高人名和术语的准确度」，默认开）。带了背景后 Whisper 偶尔把开头一段合成一整行，已按句子重新切开。

设置 → 常规 → 「无字幕视频：生成字幕」可以把识别交给云端服务，此时不需要本机识别引擎，只需要 `yt-dlp` 和 `ffmpeg`。可以保存多个云端服务（各有自己的地址、模型和 Key）并随时切换；字幕条里也有选择器，在本机引擎和已保存的服务之间切换，选择会记住。不会在服务之间自动换用：换了服务，音频就发给了另一家，必须由你选。`asr_cloud.py` 把音频按停顿切块（静音阈值随录音音量自适应，块长按服务配置），逐块上传，再按块起点把文字放回视频时间轴：服务返回分段时间（豆包的 utterances、OpenAI 风格的 `verbose_json`）就直接用，否则把文字按句子分配到该块时长内。

| 请求方式 | 服务 | 备注 |
|---|---|---|
| `openai-transcriptions`（`/audio/transcriptions`） | 硅基流动、智谱 GLM、阶跃星辰、Groq、OpenAI、自定义 | 总是带 `response_format`（阶跃要求）；GLM 单次最长 30 秒，按 28 秒内切块 |
| `chat-audio`（`/chat/completions`，base64 音频） | 小米 MiMo | `asr_options` 在请求体顶层；base64 后限 10 MB |
| `doubao-flash` | 豆包语音（录音文件识别极速版） | 头部 `X-Api-Key`、`X-Api-Resource-Id: volc.bigasr.auc_turbo`；用 `X-Api-Status-Code` 判断结果；返回逐句毫秒时间，块可以切到 5–9 分钟 |

- 重试：429 和 5xx 按 `Retry-After` 或带抖动的指数退避重试（最多 3 次）；鉴权失败（`cloud-auth`）和额度不足（`cloud-quota`）不重试，界面给出对应说明。并发 3。
- API Key 由扩展后台随任务发来，只放进识别进程的环境变量，不写入任务目录或缓存；`asrCloudTest` 用 2 秒测试音检查 Key 和模型。
- 地址是 `http://127.0.0.1…` 时视为本机服务，可接 whisper.cpp server、faster-whisper-server 等 OpenAI 兼容服务。
- 实测（B 站 41 分钟中文课程，含下载转码）：豆包 20.6 秒，智谱 32.9 秒，硅基流动 Qwen3-ASR 43.3 秒。硅基流动的 SenseVoiceSmall 排队时每个请求要十几秒，不推荐。
- 本机服务（已验证）：`uvx --from "mlx-qwen3-asr[serve]" mlx-qwen3-asr serve --host 127.0.0.1 --api-key local`，在设置里选「本机服务（OpenAI 兼容）」，地址 `http://127.0.0.1:8765/v1`。Apple 芯片上 5 分钟音频约 10 秒，音频不出本机。注意该服务默认监听 `0.0.0.0`，务必加 `--host 127.0.0.1`。

