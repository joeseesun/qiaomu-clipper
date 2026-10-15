## 中文

### 新增与改进
- 播放器支持原文、中文、双语字幕和关闭，首次开启默认双语，记住显示偏好；中文原字幕直接显示。
- 字幕保留原始时间区间，处理重叠字幕，随暂停、跳转和倍速更新；支持 YouTube、B 站嵌入播放器和普通视频的带字幕全屏。
- 文稿的「中文译文」开关移到 Transcript 标题旁，与播放器字幕独立。
- 「剪藏内容」默认跟随文稿，可选择原文、中文或双语并记住偏好。中文与双语剪藏等待完整翻译，取消或失败不会保存半成品。
- 测试交付增加版本及源码基线保护，继续使用原固定测试目录。

### 验证与边界
- 完整回归、类型、注入隔离和九种界面语言检查通过；模式切换、缓存、时间间隔、来源校验、剪藏等待/取消/失败均有回归覆盖。
- 自动化使用模拟翻译响应和播放器时钟，不代表真实模型翻译质量或逐站播放验收。视频需有可读取字幕；无字幕时使用既有「生成字幕」入口。
- 仅播放器当前与即将播放的字幕按需翻译，全文剪藏使用独立文稿翻译。原文模式不调用翻译服务。
- 本地助手继续使用现有版本；本次不升级助手。商店审核状态与 GitHub 发布状态分别核对。

### 升级
重载原扩展，刷新视频页面并重新打开沉浸学习。固定测试目录不变。

## English

### Added and improved
- Player captions support original, Chinese, bilingual and off modes. Bilingual is the initial enabled mode; display preferences are remembered. Chinese source captions need no translation provider.
- Preserve source cue intervals, handle overlapping cues and follow pauses, seeking and playback speed. Support captioned fullscreen for YouTube and Bilibili embeds and regular videos.
- Move the transcript's Chinese translation switch beside its heading, independently of player captions.
- Saved content follows the transcript by default, with remembered original, Chinese or bilingual overrides. Chinese and bilingual saves wait for complete translation; cancellation and failure leave the draft intact.
- Reject outdated development baselines and test-package downgrades while retaining the fixed test folder.

### Verification and limits
- Full regression, type, injection-isolation and nine-locale checks pass, covering mode switching, caching, cue gaps, trusted clocks and save waiting/cancellation/failure.
- Automated checks use simulated translation responses and player clocks; they do not prove live provider translation quality or site-by-site playback. Readable source captions are required; use the existing Generate subtitles flow otherwise.
- Player translation prioritizes current and upcoming cues; full-transcript saving uses the separate transcript translator. Original-only captions do not call a provider.
- The existing native helper does not need an upgrade. Store review and GitHub publication are verified separately.

### Upgrade
Reload the extension, refresh the source video page and reopen study mode. The fixed test folder stays the same.
