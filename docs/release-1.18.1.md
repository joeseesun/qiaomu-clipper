## 中文

### 修复与改进
- 修复抖音沉浸学习读取视频时，网页注入脚本因依赖扩展内部翻译模块而失败的问题。
- 修复 B 站页内字幕请求的编译辅助函数依赖。
- 新增网页注入隔离检查，阻止多语言或模块改动破坏网页采集。
- 九种完整界面语言的校验接入生产构建、打包和固定测试包更新；旧翻译工具遇到失败会停止，保留原文件，并检查占位符、限制重试。

- 补齐近期 Magpie 接入、套餐与思考深度设置、助手回放错误的缺失译文；翻译检查新增英文占位检测。

### 验证与边界
- 抖音三种视频来源在序列化后独立执行的回归测试通过；B 站页内请求经过实际编译、序列化后测试。
- 语言检查验证已识别文案的覆盖、占位符、链接和标记，不代替母语审校；新增文案仍需补齐翻译。
- 抖音读取修复由维护者实测确认；自动化未再次验证真实播放。
- 商店审核和 GitHub 发布是独立状态。助手仍为 1.16.2，本次不需要升级助手。

### 升级
重载扩展、刷新原视频页面，再重新打开沉浸学习。固定测试目录保持不变。

## English

### Fixes and improvements
- Fix Douyin study-mode media discovery failing because injected page code referenced the extension's translation module.
- Remove an unavailable compiled async helper from Bilibili's in-page subtitle request.
- Add injection-isolation checks to catch module and localization changes that would break page collectors.
- Check all nine complete UI locales during production builds, packaging and test delivery. The legacy translation tool now stops on failure, preserves the target file, validates placeholders and bounds retries.

- Complete translations for recent Magpie setup, plan and reasoning controls, and helper replay errors; detect English fallback sentences incorrectly stored as translations.

### Verification and limits
- Regression tests serialize and independently execute all three Douyin media paths and the production-compiled Bilibili page request.
- Catalog checks cover recognized strings, placeholders, links and markup; they do not replace linguistic review. New wording still needs translations.
- The maintainer confirmed the Douyin reading fix through manual testing. Automated live playback has not been reverified.
- Store review and GitHub publication are separate. The helper remains 1.16.2 and does not need an update.

### Upgrade
Reload the extension, refresh the source video page and reopen study mode. The fixed testing folder is unchanged.
