## 中文

### 修复
- 修复小红书视频已读取成功、生成字幕却立即显示 `bad-request`：后台现在放行经过校验的小红书音视频地址。
- 小红书签名音视频请求不读取或携带浏览器登录信息。

### 升级
- 更新扩展并重新加载，关闭旧学习页，从原视频重新进入。已安装 1.16.1 助手无需重装。

### 未验证
- 回归覆盖学习页请求经过后台到助手的发送边界，不代表所有视频或浏览器均已实测。

## English

### Fixed
- Allow validated Xiaohongshu media through the background caption request handler, fixing immediate `bad-request` errors after successful video detection.
- Do not read or forward browser login information for signed Xiaohongshu media.

### Upgrade
- Reload the updated extension and reopen the study reader from the source video. The 1.16.1 helper does not need reinstalling.

### Not verified
- Regression coverage exercises the reader request through the background to native dispatch; it does not establish compatibility with every video or browser.
