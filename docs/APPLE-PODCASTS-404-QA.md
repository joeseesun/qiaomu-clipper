# Apple Podcasts 地区目录 404 修复

更新时间：2026-10-25（Asia/Shanghai）。源码基线：`cbd122c03f41ad46025a1050f33f9bd957260b0f`，集成工作区 `qiaomu-clipper-image-captions`。

## 原因与范围

用户报告单集 `1000797277485` 的 `[apple:podcasts] Unable to download JSON metadata: HTTP Error 404`。同一 ID 实测中国区 catalog 404，美国区成功返回标题与公开音频。真实中国区单集网页也可能直接返回 404。美国区音频服务器返回 206。

确认后的复现链接：
`https://podcasts.apple.com/cn/podcast/508-true-dominance-starts-with-mastering-you-with/id1242394336?i=1000797277485`

这是从 Apple 返回的正式单集链接改为中国区得到的复现输入；反馈用户的完整原链接、系统和助手版本尚未提供。早期怀疑的 catalog 路径双斜杠经正常样本对照未证实为根因。

## 实现

- `native/asr.py`：探测与下载共用地区回退判断。仅 Apple HTTPS 单集、错误中的相同单集 ID、网页/JSON 元数据 404，才尝试一次美国区；保留查询参数和原始来源身份。美国区及无地区链接不继续切换。
- CDN 下载 404、登录/403/500、其他域名、重复或不一致单集 ID 均不触发地区回退。原有网络恢复规则保留。
- 探测两次共用 60 秒截止时间，临时 Cookie 在失败/超时后照常清理；下载切换前清理不完整音频。
- 禁用终端颜色并过滤控制字符。没有放宽任意媒体地址接收权限，也没有更改云端模型选择或上传设置。
- `native/test_asr_apple.py`：10 项测试，覆盖上述恢复、拒绝、超时和文件清理路径；旧代码先失败，再验证修复。

## 真实验证

最终源码执行 `python3 -m unittest discover -s native -p 'test_*.py'`：245 项通过（46.129 秒）；`git diff --check` 通过。

1. 新源码通过 `asr.probe` 从中国区链接恢复，返回目标单集标题、3772 秒时长和音频地址。
2. 通过真实 `asr.download` 下载 63,875,444 字节音频：第一轮中国区失败，第二轮美国区成功。
3. 截取第 120 秒起的 20 秒，调用本机 MLX Whisper，经真实 `asr.recognise` 产出 4 条带起止时间的英文字幕。不是完整一期转写；原始下载音频和测试 WAV 已清理。
4. 本机注册宿主 `/Users/joe/.local/share/qiaomu-clipper/host.py` 接收真实 Native Messaging 帧的 `asrProbe` 请求，返回同一单集标题、时长和音频。未模拟或点击浏览器 UI。

证据位于 `build/qa/apple-podcasts/`：`probe.json`、`transcription.json`、`installed-probe.json`、`native-tests.log`、`source.patch`、`helper.patch`、`installed.json`。

## 本机交付与回退

仅将本次 diff 应用于已安装的 `asr.py`，临时文件校验后原子替换，保留已安装文件中其他差异。10 项 Apple 回归也针对已安装模块通过。

- 修复后已安装 SHA256：`4b5255278c17b9190c0daafb047f43b4b62424674f924f7e30d5ed8d7af96000`。
- 原文件备份：`build/qa/apple-podcasts/installed-asr-before.py`；原 SHA256：`cc0ebef729f5b35b783c68c5af515d4310d03a7f0657e784a2c751ad71660751`。
- 如需回退，只恢复该文件，确认目标摘要仍为本次安装摘要，勿覆盖后续更新。
- 扩展源码和固定测试入口未变，因此无需重建或替换扩展；下一次助手请求加载新版代码。已有失败任务不自动重启，用户需重新触发生成。
- 本次没有提交、推送、打包或发布。反馈用户要获得自动修复，需要后续发布并安装包含此改动的助手包。浏览器播放器、字幕滚动、用户现场及 Windows 未实测。

## 工作区说明

该集成工作区已有快捷键、X 媒体上传、图片图注等未提交改动；本次仅新增此记录与 Apple 回归文件，修改 `native/asr.py`。未提交或打包其他线程改动。
