# Qiaomu Clipper：语音字幕 API 与开源方案调研

调研日期：2026-10-05。依据官方文档、GitHub 仓库和部分源码；尚未进行付费 API 调用、模型部署或真实视频性能测试。文中的优先级是选型建议，不是实测排名。

## 结论

建议把此前“浏览器本地 Whisper 优先”的设想调整为：平台字幕优先；无字幕时由用户选择云端实时识别/翻译，或本地识别。首版先验证云端流式路径，本地服务保留为隐私与离线选项。

“用别人的 Whisper 更稳”需要拆开判断：托管服务能减少下载模型、GPU 驱动、浏览器内存和设备性能差异，但没有自动解决网络、断连、字幕时间轴、中文翻译和浏览器音频采集。用于在线字幕时，优先比较原生流式 ASR，而不是仅比较 Whisper 托管厂商。

## 服务候选

| 服务 | 接口与用途 | 价格核验与注意点 | 本项目建议 |
| --- | --- | --- | --- |
| 阿里百炼 Fun-ASR-Realtime | 实时音频输入与识别结果输出 | 北京地域页面原价 0.00033 元/秒，折合 1.188 元/音频小时；翻译另计 | 国内 ASR + 现有 LLM 翻译候选 |
| 阿里百炼 Gummy Realtime | 同一会话识别和翻译；有时间戳，支持英/日/韩等到中文，须核对具体语言对 | 文档单项 0.00015 元/秒；识别与翻译分别计费。两项都开、一个翻译目标，基础估算 1.08 元/小时，最终按账单核验 | 国内双语字幕优先验证候选 |
| 火山引擎豆包流式 ASR | 实时流式识别适用于会议和直播字幕 | 存在实时识别与一句话识别两种路径；不能把 bigmodel_nostream 当实时中间结果接口。模型/小时包/并发包按控制台确认 | 国内第二候选，需先核对 WebSocket 接口和地域 |
| 腾讯云实时 ASR | WebSocket、签名鉴权、增量结果 | 价格按 ASR 产品资源包核验，不能使用 TRTC AI 对话报价代替 | 有腾讯云账号用户的兼容选项 |
| 讯飞实时语音转写大模型 | WebSocket、签名 URL、16k 单声道音频 | 按开放平台套餐核验；需处理音频分帧与连接超时 | 中文/方言测试候选 |
| Soniox | 实时转写与译文可一起输出；中文在语言表中 | 实时转写约 $0.12/小时，是 token 计费的等效估算；翻译增加输出文本量，不能假设双语最终账单恒为该数字 | 海外双语字幕优先候选 |
| Deepgram Nova-3 | 原生 WebSocket 流式识别，提供词时间戳和 final 状态 | 当前单语流式 $0.0048/分钟，约 $0.288/小时；促销、附加能力、套餐会影响账单。中文支持和 language=multi 混语支持不是同一覆盖范围 | 海外 ASR + 自选翻译候选 |
| ElevenLabs Scribe v2 Realtime | WebSocket、partial/committed、可选词时间戳、浏览器临时 token | 与文件版 Scribe v2 分开选型；本轮不把套餐展示价格作为统一 API 单价 | 浏览器接入与时间戳候选 |
| OpenAI | 当前实时转写指南推荐 gpt-live-transcribe；另有 gpt-realtime-translate 实时翻译会话 | 实时转写模型不返回词时间戳、说话人和置信度；翻译会话输出音频及文本，需核验字幕用途成本与事件对齐 | 已有 OpenAI 用户的可选接入，不沿用 whisper-1 文件接口设计 |
| Groq Whisper Large v3 Turbo | 托管 Whisper 文件转写，OpenAI 风格 HTTP API | $0.04/小时；每请求最低按 10 秒计费。每 3 秒提交一个无重叠文件的基础有效成本约 $0.133/小时，重叠与重试会更高 | 批量/预生成字幕；实时主线慎用分块模拟 |

官方依据：

- [Fun-ASR-Realtime 模型价格](https://help.aliyun.com/zh/model-studio/fun-asr-realtime)、[WebSocket 接入](https://help.aliyun.com/en/model-studio/fun-asr-realtime-websocket-api)。
- [Gummy 功能与语言对](https://help.aliyun.com/zh/model-studio/real-time-speech-translation/)、[识别和翻译分别计费](https://help.aliyun.com/zh/model-studio/real-time-websocket-api/)。
- [豆包流式识别概述](https://www.volcengine.com/docs/6561/1354871?lang=zh)、[一句话识别接口](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。当前概述页面存在 JS 渲染读取限制；没有在本报告臆造实时接口地址。
- [腾讯云实时 ASR](https://cloud.tencent.com/document/product/1093/48982)、[讯飞实时转写大模型](https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html)。
- [Soniox 翻译 API](https://soniox.com/docs/translation/get-started)、[语言表](https://soniox.com/docs/translation/supported-languages)、[API token 价格](https://soniox.com/pricing)。价格页的竞品比较不作为竞品事实依据。
- [Deepgram 模型/语言](https://developers.deepgram.com/docs/models-languages-overview)、[价格](https://deepgram.com/pricing)。
- [ElevenLabs 浏览器接入](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming)、[稳定结果与时间戳](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies)。
- [OpenAI 实时转写](https://developers.openai.com/api/docs/guides/realtime-transcription)、[实时翻译](https://developers.openai.com/api/docs/guides/realtime-translation)。
- [Groq 模型价格](https://console.groq.com/docs/model/whisper-large-v3-turbo)、[文件接口与最低计费](https://console.groq.com/docs/speech-to-text)。

## GitHub 项目：按可学习的部分选择

| 仓库 | 能力与参考价值 | 边界 | 仓库许可证 |
| --- | --- | --- | --- |
| [collabora/WhisperLive](https://github.com/collabora/WhisperLive) | 流式服务器、Chrome/Firefox 扩展、partial/committed 回调、词时间戳；端到端参考优先 | 需运行服务器；“nearly-live”不等于所有机器都能低延迟；浏览器要分别验证 | MIT |
| [QuentinFuxa/WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) | WebSocket、Web UI、多 ASR 后端、翻译、LocalAgreement/SimulStreaming；本地可选引擎参考优先 | 依赖和模型组合较复杂；不同后端能力不同；包许可证不代替模型权重许可证 | Apache-2.0 |
| [ufal/SimulStreaming](https://github.com/ufal/SimulStreaming) | 研究稳定提交和同时翻译策略 | 主要是模型与流式算法，不是即装即用网页字幕插件；默认翻译模型的中文能力须单独确认 | MIT |
| [ufal/whisper_streaming](https://github.com/ufal/whisper_streaming) | LocalAgreement：连续结果一致的前缀才提交，避免窗口拼接重复 | README 已推荐向 SimulStreaming 演进；适合读算法，不宜当唯一新后端 | MIT |
| [minh1997/yt-realtime-translate](https://github.com/minh1997/yt-realtime-translate) | MV3、offscreen、AudioWorklet、侧栏、仅翻译稳定文本；浏览器采集参考优先 | 当前仓库未发现顶层许可证；只学习结构，直接复用前需确认授权；队列无界与媒体时间映射需要另查 | 未明确 |
| [xu-0306/live-subtitle](https://github.com/xu-0306/live-subtitle) | tab 音频到 WhisperLiveKit、本地字幕叠层、翻译调度器、服务配置 | public preview，桌面包装以 Windows 为主；当前仓库未发现顶层许可证 | 未明确 |
| [MohammdKopa/kami-subs](https://github.com/MohammdKopa/kami-subs) | Native Messaging 启动本地服务、tabCapture、字幕叠层、本地翻译 | Windows 为主；音频代码用了已弃用 ScriptProcessor 和简易重采样，不能原样当生产方案 | MIT |
| [lqo-l/Video-AI-Subtitle](https://github.com/lqo-l/Video-AI-Subtitle) | YouTube/Bilibili、已有字幕优先、本机 Whisper 回退、中文翻译与摘要 | 适合研究平台字幕与语音回退流程；不能从 README 推定所有视频都支持连续实时识别 | Apache-2.0 |
| [nopol10/nekocap](https://github.com/nopol10/nekocap) | 社区字幕、多个视频平台、字幕挂载/编辑 | 不是 ASR 服务；学习播放器适配与字幕 UI。直接复用需匹配 GPL 要求 | GPL-3.0 |

许可证来自本轮 GitHub 元数据与仓库文件检查，不代表依赖/模型的完整许可证审核。本轮不按 star 排名，也未安装运行这些项目。

## 已检查源码的具体发现

1. [yt-realtime-translate/background.js](https://github.com/minh1997/yt-realtime-translate/blob/main/src/background/background.js)：明确组织 action 点击、targetTabId 与 offscreen 创建；只把 isFinal 文本送入串行翻译。其关于 sidePanel 权限的解释属于该项目经验，仍须用 Chrome 官方权限规则和本项目实机验证。
2. [yt-realtime-translate/offscreen.js](https://github.com/minh1997/yt-realtime-translate/blob/main/src/offscreen/offscreen.js)：声音一路接 AudioContext.destination 保持可听，另一路经 AudioWorklet 分析。适合学习采集与输出拆分。
3. [live-subtitle/translation_scheduler.py](https://github.com/xu-0306/live-subtitle/blob/main/backend/translation_scheduler.py)：provider 与全局 semaphore 双层限制并发，记录排队/执行耗时及取消；适合借鉴调度指标。只有并发限制还不足以证明排队总长度有界。
4. [kami-subs/offscreen.js](https://github.com/MohammdKopa/kami-subs/blob/main/extension/offscreen.js)：声音回放路径清楚，但分析路径使用 createScriptProcessor，重采样注释也承认是简单线性插值；参考架构时换为 AudioWorklet 与合适的重采样器。
5. whisper_streaming README 说明固定大小窗口容易切断词，提出稳定前缀确认和缓冲窗口滚动。模型输出可以修订，字幕必须区分 partial 与 committed。

## 对 Qiaomu Clipper 的架构建议

```text
平台原有字幕 ─────────────────────────────┐
用户启动标签页音频采集 → offscreen        │
                         ↓               │
                 ASR/翻译适配器           │
                 ├─ 国内 Gummy            │
                 ├─ 海外 Soniox           │
                 ├─ ASR + 现有 LLM 翻译    │
                 └─ 本地 WhisperLiveKit   │
                         ↓               ↓
                统一字幕数据与状态 → 原文/中文展示
                                      → 搜索、回放、导出、Obsidian
```

- 功能命名为“实时字幕”，设置中选择识别服务；不把 Whisper 当用户必须理解的产品名称。
- 平台字幕始终优先；“字幕接口受阻”和“视频确实无字幕”分开提示。不要自动把所有原字幕失败都触发付费转写。
- 采集与识别独立：换云端服务不应重新实现 tabCapture；云端识别也不会免除用户启动采集。
- 临时文本用于当前字幕预览，稳定文本进入搜索、导出和翻译。provider-native 翻译与独立 LLM 翻译都写入同一 cue，避免重复扣费和重复插入字幕。
- provider 返回时间戳常是音频会话内偏移。必须映射到视频 currentTime；暂停、跳转、倍速变化要更新分段锚点与 epoch，丢弃旧会话迟到结果。断网缺失段明确标记。
- live 模式显示最近稳定字幕；回放模式按媒体时间查 cue。不要用“接口返回时的视频位置”冒充语音发生时间。
- 接入不能只抽象成 baseURL/APIKey/model：WebSocket 鉴权、临时 token、采样率、PCM/Opus、commit 语义、时间戳均需 capability。浏览器不支持的鉴权方式走轻量网关或本地 helper。
- 用户自带 Key 与产品托管两种交付方式分开；公共厂商 Key 不打包到扩展。云端模式在启动前明确音频接收方；失败时不擅自切换另一个音频接收方。
- 现有文本翻译配置保持兼容：未设置专用翻译模型时回退已有聊天模型；启用原生语音翻译时，不再对相同 cue 重复调用 LLM。

## 首轮验证范围

先对比 Gummy、Soniox、一个 ASR + 现有 LLM 组合；本地对照选择 WhisperLiveKit。避免首版同时接十家。

使用相同英/日/韩课程与中文/中英混合片段，包括专有名词、音乐、无语音、20 分钟连续播放。测量用户启动到首字、稳定原文延迟、稳定译文延迟、CER/WER、时间戳偏差、重复/漏句、断连恢复、每小时实际费用。国内网络与海外网络分别记录。

播放验收必须包括暂停、拖动、0.75x/1.5x/2x、全屏、SPA 切视频、关闭学习页、后台标签页及云端失败。不能用厂家宣传的模型延迟替代“视频声音到中文字幕”的端到端延迟。

研究后建议：国内先验证 Gummy 的原文 + 中文译文流；海外先验证 Soniox；读取 WhisperLive 的端到端实现与 WhisperLiveKit 的引擎层，扩展采集结构重点参考 yt-realtime-translate。最终默认服务由实测结果决定。
