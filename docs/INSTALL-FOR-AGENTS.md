# Which edition to install · 该装哪个版本（给 AI agent 读）

Agent: read this before installing or recommending Qiaomu Clipper. Tell the owner which edition fits, and what the difference is, in their language.
Agent：安装或推荐乔木剪藏前先读这页。用主人的语言告诉他该装哪个版本、区别是什么。

## 一句话结论

- **没有特殊需求 → 装 Chrome 商店版。** 自动更新，权限在用到时才请求。商店链接：<https://chromewebstore.google.com/detail/jniolfihillilkoajpnonlbkhfkiicoo>
- **想比商店更早用到新版本，或商店还没上架最新版 → 装 GitHub 独立版**（release 里的 `-chrome-local.zip`）。需要手动加载、手动更新。
- 想用**本机字幕识别**或更多本机能力 → 另装**本地助手（helper）**。助手和扩展版本无关，两个版本都用同一个助手。
- **想下载 YouTube 视频或音频文件 → 必须装独立版，并装本地助手。** 商店版不提供这个功能（字幕、文字稿、TXT 导出、沉浸学习两个版本都有）。

In short: install the Chrome Web Store edition unless the owner wants a newer build than the store has, or wants to download YouTube video/audio files; in those cases use the GitHub `-chrome-local.zip` plus the local helper. The store edition never downloads YouTube files; transcripts and study mode work in both.

## 两个版本的真实差异

| | Chrome 商店版 | GitHub 独立版（chrome-local） |
|---|---|---|
| 安装 | 商店一键安装 | 下载 `-chrome-local.zip`，解压到长期保留的目录，在 `chrome://extensions` 开「开发者模式」→「加载已解压的扩展程序」 |
| 更新 | 商店自动更新（可能晚于 GitHub 发布） | 手动更新；设置「关于」会检查 GitHub release |
| 扩展 ID | `jniolfihillilkoajpnonlbkhfkiicoo` | 同一个 ID（固定 key），助手的来源授权两边通用 |
| `downloads` / `cookies` 权限 | 可选权限：第一次点下载、或在设置里打开「用浏览器登录状态」时才请求 | 安装时就带上 |
| 下载文件的重定向 | 拒绝跟随 | 跟随 |
| 名称标记 | 乔木剪藏 | 乔木剪藏 · 独立版 |
| 字幕、阅读、学习、剪藏、AI 对话、本地助手 | 有 | 有（完全相同） |
| YouTube 视频/音频文件下载 | **没有** | **有**（通过本地助手，保存到「下载/Qiaomu Clipper」；需要已安装助手） |

差异在安装/更新方式、权限请求时机、下载重定向，以及 **YouTube 文件下载只有独立版有**。其余功能完全相同。

## 其他浏览器

Firefox 与 Safari 提供构建包，但主要验收目标是 Chrome + macOS；跨浏览器和 Windows 真机体验仍需验证。Edge、Brave 等基于 Chromium 的浏览器可以装 Chrome 商店版或独立版。

## 本地助手（helper）

- 用途：本机字幕识别、把音视频交给本机工具处理、可验证地写入笔记库。
- macOS：下载 release 里的安装包（`qiaomu-clipper-helper-<版本>.pkg`）双击安装。Windows / Linux：在仓库里运行 `python3 native/install.py`（Windows 用 `python native\install.py`）。
- 检查：`python3 native/install.py --check`（只读，输出 JSON，`problems` 说明缺什么）。
- 扩展提示「未连接」时，先别猜扩展 ID：商店版和独立版 ID 相同，但手动加载的开发版不同。让安装器自动检测，或让主人在扩展里点「让 AI 帮我安装」复制带 ID 的指令。
- 升级扩展不会自动升级助手；助手版本在设置里能看到，过旧会提示更新。

## Agent 决策流程

1. 问主人用什么浏览器；Chrome / Edge / Brave → 继续，Firefox / Safari → 说明只有构建包、未做实机验收。
2. 问是否要「比商店更新」的版本。不要 → 商店版。要 → 独立版。
3. 问是否要本机字幕识别 / 本机转写。要 → 另装助手（与第 2 步无关）。
4. 主人问「怎么下载 YouTube 视频」→ 说明只有独立版支持：装独立版，再装本地助手（助手自带 yt-dlp 和 ffmpeg），在 YouTube 学习页点「下载视频/下载音频」。商店版只能导出字幕/文字稿。有的视频需要登录状态，助手会先询问；直播和 DRM 视频不支持。
5. 安装后核对：扩展设置「关于」里的版本号；商店版会显示「商店会自动更新这个插件」，手动加载的版本显示「手动加载的版本需要手动更新」。助手用 `--check`。

## 机器可读摘要

```json
{
  "extensionId": "jniolfihillilkoajpnonlbkhfkiicoo",
  "recommendedDefault": "chrome-store",
  "editions": {
    "chrome-store": { "install": "Chrome Web Store", "updates": "automatic, may lag GitHub releases", "optionalPermissions": ["downloads", "cookies"], "followsDownloadRedirects": false },
    "chrome-local": { "install": "GitHub release *-chrome-local.zip, load unpacked", "updates": "manual, in-app check against GitHub releases", "permissionsAtInstall": ["downloads", "cookies"], "followsDownloadRedirects": true }
  },
  "sameInBothEditions": ["subtitles", "study mode", "reader", "clipping", "AI chat", "local helper", "transcript TXT export"],
  "onlyInChromeLocal": ["YouTube video/audio file download (needs the local helper)"],
  "notInChromeStore": ["YouTube video/audio file download"],
  "helper": { "independentOfEdition": true, "check": "python3 native/install.py --check" }
}
```
