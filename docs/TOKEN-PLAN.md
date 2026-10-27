# Token Plan 原生工具

在「模型」设置中配置阿里云百炼 Token Plan 的服务地址、API Key 和支持的模型后，AI 对话直接使用同一把模型密钥调用服务端内置工具，无需再填写第三方搜索服务的密钥。

支持以下服务地址形式，扩展会为原生工具对话选择对应的 Responses API：

```text
https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses
```

## 能力与使用

| 能力 | 用途 | Qwen 3.8 Max / Flash | DeepSeek V4.1 Flash 1017 |
|---|---|---|---|
| `web_search` | 查询网络资料 | 支持 | 支持 |
| `web_extractor` | 读取公开网页链接 | 支持 | 支持 |
| `code_interpreter` | 在服务商沙箱执行 Python，进行计算或数据处理 | 支持 | 支持 |
| `web_search_image` | 按文字描述搜索现有图片 | 支持 | 未提供 |
| `image_search` | 根据本轮实际附图搜索相似图片 | 支持 | 未提供 |
| 图片理解 | 根据网页中选中的实际图片回答 | 支持 | 支持 |

此表是两个常用模型系列的对照；其他已识别型号的工具、视觉和思考档位见 `src/utils/token-plan.ts`。只对明确识别的 Token Plan 地址与型号启用原生适配，其他服务和未知型号沿用已有调用路径。不会改写用户的模型选择或自动替换模型 ID。

在原页面、阅读页的 AI 对话中直接提出问题，例如：

- 「联网核实这个说法，给出来源链接。」
- 「读取这个公开链接，概括其中的变化。」
- 「用 Python 精确计算 123456789 的 7 次方。」
- 「找几张埃菲尔铁塔的照片。」
- 在含图片的网页中保留图片选择，再问「根据图 1 搜索相似图片」。

输入框旁的地球按钮为「联网：自动」时，模型根据问题选择工具。关闭后不再提供搜索、网页读取和两种搜图工具，Python 计算仍可用。代码由服务商沙箱执行，不是在用户电脑上运行；联网开关不是对服务商沙箱的网络隔离措施。

模型菜单显示该型号支持的思考档位。服务端返回的思考文本可展开查看，并随本地历史恢复。历史继续沿用现有本地对话机制，包含有长度限制的真实工具结果；没有使用服务端的 `previous_response_id`，请求设置 `store: false`。图片字节仅用于当前请求，历史保留图片编号，不存图像字节。

工具卡片显示实际执行状态、来源、图片、代码和输出。中断、失败和不完整响应会提示错误，不能仅因 HTTP 200 就当作执行成功。重试按钮会发起新一轮请求，模型决定如何重试。

## 边界

- 看图、思考和工具调用按各模型实际支持范围启用，不表示所有模型都有五项工具。
- 网页读取面向服务商可访问的公开链接，不能替代用户登录后的浏览器访问。
- 搜图返回现有图片，不是图片生成；图片能否加载及使用许可由原站决定。
- 这项改动不增加图片、音频或视频生成模型，也不增加本机命令执行、文件上传或自定义 MCP 工具。
- 原生工具可返回事实证据，但模型的归纳仍可能有误；查看来源与工具输出，不把模型自行声称「已经联网」当作执行证据。

## 验证与复现

自动测试包括地址与型号识别、联网开关、图像输入条件、实际五种工具的响应形状、UTF-8/SSE 分片、重复结束事件、错误与中断、工具结果保存、跨页面后台通信以及不影响其他服务商的回归。界面测试验证返回内容作为文本展示，不执行工具结果中的 HTML。

手工测试可使用 [公开测试页面](examples/token-plan.html)。本地预览：

```sh
python3 -m http.server 18766 --bind 127.0.0.1 --directory docs/examples
```

打开 `http://127.0.0.1:18766/token-plan.html`，再从扩展打开「AI 对话」。只需配置测试者自己的 Token Plan 密钥，不填写第三方搜索密钥。

| 检查 | 步骤与验收点 |
|---|---|
| 搜索、读取、计算 | 使用 DeepSeek 1017，明确要求调用三项工具；核对三类卡片、来源链接和 Python 输出。 |
| 多轮上下文 | 第一轮给出口令「青竹47」并完成计算，下一轮询问口令及结果末六位；应保留上下文。 |
| 联网开关 | 关闭联网后追问上述上下文，不应新增网络工具调用；测试后恢复原设置。 |
| 看图与搜图 | 使用 Qwen 3.8 Max，选择测试页图片，描述主体后调用以图搜图，再用文字搜索埃菲尔铁塔照片；核对两类工具及实际图片。 |
| 历史恢复 | 关闭并重新打开对话，核对回答、思考文本、工具记录及来源仍可查看。 |
| 思考档位 | DeepSeek 1017 提供 none/low/high/max；Qwen 3.8 Max 提供 none/low/medium/xhigh；均保留自动选项。 |

真实 API 与 Chrome 实测覆盖 Qwen 3.8 Max、DeepSeek V4.1 Flash 1017；其他适配型号未逐一进行付费调用验收。公开截图及其来源说明见 [界面验证](TOKEN-PLAN-VERIFICATION.md)。

## 官方依据

- [Token Plan](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)
- [Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)
- [代码解释器](https://help.aliyun.com/zh/model-studio/qwen-code-interpreter)
- [文搜图](https://help.aliyun.com/zh/model-studio/web-search-image)
- [图搜图](https://help.aliyun.com/zh/model-studio/image-search)
- [DeepSeek V4.1 Flash](https://help.aliyun.com/zh/model-studio/deepseek-v4-1-flash)

## English

For recognized Alibaba Cloud Token Plan endpoints and models, chat uses the Responses API and the existing model API key for native tools. No separate search API key is required. Tool availability, vision support and reasoning levels are model-specific; other providers and unknown models retain their existing request path. The web toggle removes the four network tools while keeping the provider's Python interpreter available. Tool results, sources and reasoning text are displayed and retained in local chat history, with bounded fields and no persisted input-image bytes. Live API and installed-Chrome checks cover Qwen 3.8 Max and DeepSeek V4.1 Flash 1017, not every listed model.
