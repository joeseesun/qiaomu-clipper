# 字幕翻译吞吐优化验收

更新时间：2026-10-27（Asia/Shanghai）。基线提交 cbd122c03f41ad46025a1050f33f9bd957260b0f。
集成工作区为固定测试包 CURRENT.json 指定的 qiaomu-clipper-image-captions；保留该工作区其他未提交改动，不包含提交、推送或商店发布。

## 改动

- 正文预算仍为 3500 字符，每批短字幕上限从 6 提至 24；不截断原文，不合并或重排字幕 ID。
- 同批相邻原文提供上下文，仅在批次边界及补译缺口附带前后各最多 500 字符，省去重复输入；系统提示固定且不含时间或任务 ID。
- 最多 6 个在途请求；HTTP 429 后本轮上限减半（最低 1），初次请求、传输重试及格式恢复共用同一限制。已在途请求允许完成，等待队列可取消；沿用最多两次传输重试。
- 按模型 ID 识别 DeepSeek，为翻译单次请求显式关闭思考；保留 OpenRouter、Responses 的协议格式，不修改保存的聊天偏好，也不选择或替换用户模型。
- 预先建立字幕段落索引，避免每批渲染反复扫描全部原文分段。
- 没有新增持久译文缓存、共享服务器、上传或译文复用。仍等每批完整返回后按 ID 校验并显示；流式逐条显示不在本轮。

## 独立证据

新增用例先在未修改实现上运行，确认 5 项失败（138 次请求、3 路并发、自定义反代未设置关闭思考等），再运行修改版。

相同 824 条合成短字幕，调用真实 mountTranslation/分批/DOM 渲染代码，模型由固定 2 秒响应的测试替身代替；每条译文都检查了落位。无缓存命中。

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 模型请求数 | 138 | 35 |
| 最大在途请求 | 3 | 6 |
| 总输入字符数（system + user） | 552104 | 183923 |
| 固定延迟下的模拟完成时间 | 92000 ms | 12000 ms |

输入字符减少约 66.7%，请求数减少约 74.6%。字符数不是 token 数；模拟时间只说明调度开销，不是 DeepSeek 或反代的实测速度，未计算真实生成随输出长度增长的时间。翻译质量、真实 token 用量、首字及全文耗时仍需同原文、同模型、同反代做对照。

本轮定向回归 49 项通过，覆盖已有格式恢复、取消、保存、原文选区，以及新增并发上限、乱序、连续限流、排队取消、补译上下文和模型参数。TypeScript --noEmit 通过。

命令：

```sh
node node_modules/vitest/vitest.mjs run src/utils/youtube-translation.test.ts src/utils/youtube-translation-performance.test.ts src/utils/chat-thinking.test.ts src/utils/chat-llm.test.ts
node node_modules/typescript/bin/tsc --noEmit
npm run build:store
npm run test:prepare
```

构建与固定入口更新的最终结果以 CURRENT.json、build-info.json 及交付脚本输出为准；不据此声称浏览器已重载或真实模型调用已验收。
