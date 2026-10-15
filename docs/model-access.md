# 账号、订阅与套餐接入

新增 Magpie 网关（检测、模型目录、模型原始 ID 与思考档位）和七个独立 Coding / Token Plan 预设：智谱、Z.ai、Kimi Code 国内、MiniMax、百炼、小米 MiMo、火山方舟。

既有 ChatGPT、TokenDance、OpenRouter 浏览器授权继续使用。Claude 等订阅由用户在 Magpie 中登录并启用模型，本扩展只使用其网关，不复制订阅 token。
本机网关默认 `http://127.0.0.1:3425/v1/chat/completions`；远程网关要求 HTTPS 和密钥。请在添加模型后选择默认项，原有默认项保持不变。

[共同支持矩阵与研究来源](https://github.com/joeseesun/qiaomu-agent/blob/main/docs/research/2026-10-11-account-and-gateway-access.md)，核对日期 2026-10-11。

测试覆盖网关身份、反向代理前缀、远端密钥边界、目录和请求回归；浏览器构建已检查。未使用每一家付费账号完成授权、扣费；商店提交与真实浏览器安装另行验收。
本次增量独立于正在准备的 1.16.0 发布 PR #66，未替换其安装包或发布候选。
