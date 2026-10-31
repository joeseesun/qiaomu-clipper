# 完整输入与模型输出预算

2026-10-27 的修改取消阅读对话、写作对话及模板解释器内的固定模型长度限制。

- 阅读对话：文章、引用、个人提示词、当前会话全部历史完整提交。界面只先显示最近消息是显示优化，不再影响模型收到的历史。
- 写作：正文、选区、续写上下文、引用文章、参考网页正文、提示词和当前会话不再按固定字符数或轮数裁剪；长回答保存及插入不会在 20,000 字符处静默截断。
- 请求：移除 Gemini、Azure、模板解释器固定 1,600/8,000 输出限制；移除 Ollama 固定上下文覆盖。
- 输出：先读取配置服务的模型目录明确输出字段（Gemini、Anthropic、OpenRouter 和相同字段的兼容服务）；结果仅内存缓存 30 分钟，失败缓存 1 分钟。仅读取元数据，不额外发送正文给其他供应商。用户填写的最大输出 token 优先。
- 未知服务：没有通用 API 可以查出所有网关的真实限制。可选参数省略后沿用服务默认值；默认值可能小于模型最大值。Anthropic 必填输出参数，未知时明确要求在模型设置填写。不会用一个猜测的巨大数字冒充“无限”。
- Ollama：默认沿用服务自身设置，用户可明确设置上下文和输出 token；扩展不自动扩张 GPU 内存分配。OAuth 账号接口沿用其服务设置。
- 超限：识别上下文错误以及 OpenAI、Anthropic、Gemini、Responses 的输出截断信号，不能将半篇回答报告为完成。X 翻译默认全文一次请求；只有服务明确超限时才缩小范围，保留段落与代码／链接校验。普通聊天超限明确报错，不暗中删历史。
- 仍保留网络下载、图片、浏览器传输、原文缓存和任务执行保护。这些不是模型上下文能力。X 原文单篇 500,000 UTF-16 字符、网页 8 MiB；网页附件超限会报错，不再静默取前半页。

依据：
- [Gemini 生成参数](https://ai.google.dev/api/generate-content)：默认输出上限随模型变化。
- [Anthropic 模型元数据](https://platform.claude.com/docs/en/api/models/retrieve)、[Messages](https://platform.claude.com/docs/en/api/messages/create)：输出与输入上限分开，Messages 要求 max_tokens。
- [OpenRouter 模型目录](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)：context_length 与 top_provider.max_completion_tokens 分开。
- [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)：省略 max_tokens 的默认值与最大值不同。
- [阿里云 DeepSeek API](https://help.aliyun.com/en/model-studio/deepseek-api)：对应服务模型的默认参数按服务文档核对，不能直接套用 DeepSeek 官方默认值。
- [Ollama 上下文](https://docs.ollama.com/context-length)：本机分配受服务配置与硬件内存影响。
