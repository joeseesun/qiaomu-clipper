# Chrome 插件市场发布准备

本仓库独立管理乔木剪藏；商店首版 1.7.1 已上线，1.14.1 的审核已于 2026-10-06 撤回；模型添加修复需完成真实安装验收后重新提交。源码与上游 MIT 许可证保留，扩展市场应使用本项目的名称、支持地址和包，而不是上游 Obsidian 安装链接。

## 包与材料

运行 `npm ci`、`TZ=America/Los_Angeles npm test`、`npx tsc --noEmit`、本地助手测试和 `npm run build:chrome`。上传 `builds/qiaomu-clipper-<version>-chrome.zip`；ZIP 根目录必须有 `manifest.json`，不应包含本地助手、测试、个人笔记、配置凭证或服务端运维文件。

发布前统一 package 和各 manifest 版本号，完成真实界面截图、商店中英文介绍、图标、开发者支持渠道和公开可访问的隐私政策地址。仓库已公开。隐私政策地址：https://joeseesun.github.io/qiaomu-clipper/privacy.html 。完整可粘贴表单与审核步骤见 [商店提交资料](store/SUBMISSION.md)。

## 当前权限用途

| 权限 | 用途 |
|---|---|
| activeTab、scripting | 用户剪藏时提取当前页面，运行高亮与阅读模式 |
| storage | 模板、设置、待重试内容和预览草稿 |
| clipboardWrite | 复制属性、Markdown，以及无助手时的 Obsidian 保存 |
| nativeMessaging | 调用用户另行安装的本地保存助手 |
| contextMenus | 右键剪藏操作 |
| sidePanel | Chrome 侧边栏剪藏 |
| declarativeNetRequest | 上游阅读器的 YouTube 嵌入 Referer 规则 |
| 网页 host permissions | 网页提取、阅读模式请求、RSS 和用户配置的 AI 服务 |

Chrome Manifest 已去掉不是权限项的 commands（快捷键声明保留）和重复的 <all_urls>。HTTP/HTTPS 访问仍用于任意网页剪藏、每站三连击快捷键和用户配置的 AI 端点，逐项说明见提交资料。商店隐私申报必须说明网页内容、本地存储、匿名设备编号、默认关闭、可由用户开启的公开 RSS 投稿、可选 AI 服务的数据处理。不能宣称所有数据始终留在本机。

## 验收与审核说明

测试无助手的 URI 保存、助手离线与正常保存、选择不同库和子文件夹、选区草稿预览、正文编辑、属性复制、默认收起、RSS 取消/成功/失败重试、阅读模式剪藏和重复点击。提交内容使用可公开的测试文章。检查新安装、升级、键盘访问、窄窗口和深浅主题。

本地助手是用户另行安装的依赖，不能假定商店安装会自动安装 Python/助手；审核说明需要提供不依赖助手的测试路径。Windows 助手已有实现和自动化测试，尚待真机验证。完成商店表单、公开隐私地址与测试说明后，再提交审核；本仓库的 ZIP 成功构建不代表审核通过。

官方参考：[发布流程](https://developer.chrome.com/docs/webstore/publish)、[用户数据与隐私披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。
