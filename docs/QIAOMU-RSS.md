# RSS 接入

扩展在用户勾选“同时提交到 RSS”并点击剪藏时，通过后台发送：

```json
{"url":"https://example.com/article","title":"文章标题","markdown":"剪藏正文","image":"https://example.com/cover.jpg"}
```

接口为 `POST https://rss.qiaomu.ai/api/clipper/clips`，不使用网站登录 cookie。请求带剪藏客户端标记、协议版本及本地生成的匿名设备编号，用于客户端识别和限流。扩展提交直接收录到“读者提交”，不创建独立“乔木剪藏”栏目。网站普通投稿的审核流程独立运行。

订阅地址为 `https://rss.qiaomu.ai/feeds/user-submitted.xml`；旧 `/feeds/qiaomu-clippings.xml` 地址兼容同一源。

正文使用当前剪藏 Markdown，封面优先使用网页提取元数据；服务端可补全图片并异步生成中文标题。服务端实现属于 RSS 项目，扩展仓库提供 `integration/qmreader/clipper.cjs` 作为接口参考。不要将它当成完整 RSS 网站部署包。

本地与 RSS 结果独立显示。网络失败保留待提交内容，重试仍使用原网页地址；本地失败使用原请求编号，避免重复新建笔记。公开投稿请参阅 [隐私说明](../PRIVACY.md)。
