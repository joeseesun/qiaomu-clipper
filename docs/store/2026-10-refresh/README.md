# 乔木剪藏 · 商店宣传改版

日期：2026-10-21（Asia/Shanghai）。源码基线：集成 PR #95 / `37cc07a3c52d35a2c945e60a8ddc3ff1f863371f`。本目录是 1.19.0 的商店素材与文案；后台保存、送审和公开上线以发布记录为准。

**把看过的，变成自己的。**

通过“阅读 → 视频学习 → 随页问答 → 写作 → 配图”呈现用户可以完成的事情。基础功能无需 AI 配置；付费服务、独立助手、平台权限等前提写在对应说明和完整文案中。没有承诺所有网站可用、免费模型额度或已经完成真实服务验收。

## 查看与使用

- 打开 [完整预览](campaign.html)。
- [中文商店文案](listing-zh-CN.txt) / [English listing](listing-en.txt)。
- [发布就绪检查](READINESS.md)：记录已修复问题与验收边界。
- [素材包](qiaomu-clipper-store-assets-2026-10.zip)：7 张输出图、图标、中英文文案；不是扩展安装包。
- [提交资料](../SUBMISSION.md)同步了文案、权限说明和版本边界；隐私文档通过仓库 Pages 发布，提交审核前核对公开地址。

## 上传顺序和规格

| 文件 | 像素 | 内容 |
| --- | --- | --- |
| `screenshot-01-read.png` | 1280 × 800 | 干净阅读、剪藏与 Markdown |
| `screenshot-02-study.png` | 1280 × 800 | 视频与双语文字稿 |
| `screenshot-03-chat.png` | 1280 × 800 | 引用选段、随页提问、联网入口 |
| `screenshot-04-writing.png` | 1280 × 800 | 编辑器、大纲与写作助手 |
| `screenshot-05-gallery.png` | 1280 × 800 | 生图、上传、本地文件夹、Unsplash |
| `promo-440x280.png` | 440 × 280 | 小宣传图 |
| `marquee-1400x560.png` | 1400 × 560 | 横幅 |
| `icon128.png` | 128 × 128 | 当前产品图标 |

截图、横幅和小宣传图为 RGB PNG，无透明通道。规格依据 [Chrome 官方图片要求](https://developer.chrome.com/docs/webstore/images)；卖点表达参考 [官方商店介绍指南](https://developer.chrome.com/docs/webstore/best-listing)。正式上传前须与最终构建再次比对。

## 图像与功能证据

五张界面图来自当前源码的阅读器、学习页、聊天、写作和图库组件，使用本地演示存储、原创文章与固定示例回复。底部均标注“真实组件界面 · 示例内容”。视频播放器是海报演示画面，未播放视频；AI 回答、译文和图片库数据是演示数据，不是此次真实模型调用结果。

这些设计稿证明布局与展示内容，不证明扩展已重载、后台生图成功、真实搜索、平台草稿写入或上架。上线前应在冻结版本中完成相同流程的真实验收，必要时替换原始界面截图。

`brand-illustration.png` 是本轮用 ImageGen 生成的概念插画；没有用生成图伪造产品 UI。图库中的其他示例图片复用项目 `docs/assets/features/` 自有素材。原始 UI 截图为 `ui-*.png`，排版源文件为 `campaign.html`，组件演示源码位于 `source/`。

生成指令的核心：约 5:2 的高品质哑光纸张静物广告，陶土红背景 `#B94C36`，右侧组合打开的笔记本、网页纸片、视频播放卡片和照片，采用现有黑底白色回形针图标；左侧约 45% 留白，无文字、无虚构 UI、无第三方品牌。中文标题使用 HTML 排版，保证文字准确。

## 复现

1. 在本目录对应工作区安装依赖并运行 `npm run build:store`。
2. 运行 `node docs/store/2026-10-refresh/source/build-demo.mjs`；脚本从 `build/production/chrome-store` 复制样式与资源。也可通过 `QIAOMU_STORE_BUILD_ROOT` 指定相同源码的既有构建目录。
3. 用本地 HTTP 服务器提供 `build/qa/store-refresh/web`。`demo.html?mode=read|study|chat|write|gallery` 为实际组件演示；写作页打开 AI 助手，学习页选择停靠布局。
4. 以 1440 × 640、deviceScaleFactor 1 截取各界面为本目录 `ui-*.png`。等待页面 `data-ready`、字体与图片完成加载。
5. `campaign/campaign.html?page=1` 至 `5` 按 1280 × 800 导出；`page=marquee` 按 1400 × 560 导出；`page=small` 按 440 × 280 导出。

本轮全部 7 张输出图已在浏览器逐张渲染，无水平溢出；已目视核对标题、边距、图标与界面内容。截图并未改变用户配置、调用外部模型或修改固定测试入口。
