# 乔木剪藏 · Qiaomu Clipper

**中文** | [English](#english)

将网页或选中文字保存为 Obsidian Markdown 笔记，也可同时提交到乔木 RSS。
Save web pages or selected text to Obsidian, with optional public Qiaomu RSS submission.

[从源码安装](#快速开始) · [本地静默保存](native/README.md) · [隐私说明](PRIVACY.md) · [反馈问题](https://github.com/joeseesun/qiaomu-clipper/issues) · [MIT](LICENSE)

当前为 Chrome 开发版，尚未发布到 Chrome 插件市场。此项目基于 Obsidian Web Clipper 独立开发，上游扩展市场安装包不包含乔木功能。

## 核心能力

| 功能 | 使用效果 |
|---|---|
| 网页与选区剪藏 | 提取标题、属性及 Markdown，可编辑后保存 |
| 精简弹窗 | 属性默认收起，点击属性名称复制值，预览当前剪藏草稿 |
| 阅读预览 | 阅读模式右上角剪藏，沿用草稿的库、笔记位置和 RSS 选项 |
| 本地静默保存 | 通过可选本地助手直接写入笔记库，不必打开 Obsidian |
| 浏览选择目录 | 本机选择笔记库和库内文件夹，不固定电脑名或库名 |
| RSS 提交 | 提交链接、标题、正文和封面，进入公开“读者提交”源 |
| 失败重试 | 本地与 RSS 分开反馈，重试使用同一个本地请求编号 |

## 快速开始

需要 Node.js 22+、npm 和 Chrome。

```sh
git clone https://github.com/joeseesun/qiaomu-clipper.git
cd qiaomu-clipper
npm ci
npm run build:chrome
```

打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载本项目的 `dist` 文件夹。修改后重新构建并在扩展管理页重新加载。

默认使用 Obsidian URI 保存；要实现静默保存，请另行安装 [本地助手](native/README.md)（Python 3，macOS / Linux Chrome）。本机设置 → 常规 → 仓库选择实际 Obsidian 库根目录；模板“笔记位置”选择库内子文件夹。未安装助手时仍可手动填写相对路径。

**公开提交：**“分享到乔木 RSS”当前默认勾选，可取消。勾选后点击剪藏会公开提交网页链接、标题、剪藏正文和封面；不要将私人页面或个人笔记提交到公开 RSS。预览本身不会上传草稿。[公开 RSS](https://rss.qiaomu.ai/feeds/user-submitted.xml)

## 开发与验证

```sh
TZ=America/Los_Angeles npm test
npx tsc --noEmit
python3 -m unittest discover -s native -p 'test_*.py'
npm run build:chrome
```

测试时区用于上游日期格式测试。Chrome 构建输出 `dist/`，ZIP 位于 `builds/qiaomu-clipper-1.7.1-chrome.zip`。当前沿用上游版本号；后续发布在本仓库统一管理版本与更新记录。

- `src/`：扩展、弹窗、阅读模式与设置。
- `native/`：静默保存助手及安装器，Windows 暂不支持。
- `integration/qmreader/`：RSS 接口参考实现与测试；不随扩展 ZIP 打包。
- [Chrome 市场发布准备](docs/CHROME-WEB-STORE.md)：权限、材料、包与验收说明。

Firefox / Safari 保留上游代码，目前乔木功能以 Chrome 为验收目标。RSS 为独立在线服务；提交可能因服务限制或网络问题失败。可选 AI 解释器由用户配置服务商和密钥，会将所需网页内容发送给所选服务商，费用按服务商规则计算。

## 来源与许可证

基于 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper)，保留上游 Git 历史及 MIT 许可证。网页提取使用 [Defuddle](https://github.com/kepano/defuddle)，图标使用 Lucide。乔木剪藏由 [joeseesun](https://github.com/joeseesun) 维护；反馈请提交到本仓库。

## English

Qiaomu Clipper saves web pages or selected text as Obsidian Markdown notes. Its compact popup supports editable metadata, draft previews and a reader with a Clip action. Optional RSS submission publishes the URL, title, clipped Markdown and cover image to Qiaomu RSS's public reader-submissions feed.

This is a Chrome development build, not a Chrome Web Store release. Clone this repository, run `npm ci` and `npm run build:chrome`, then load `dist` as an unpacked extension in `chrome://extensions`. Node.js 22+ is required.

By default, notes are sent through the Obsidian URI flow. Silent saving requires the optional Python 3 Native Messaging helper on macOS or Linux Chrome; see [installation instructions](native/README.md). Configure your own vault root and choose a folder inside it. Windows helper support is not implemented.

RSS submission is currently checked by default and can be disabled. Submitted content is public. Previewing alone does not upload the draft. Local saving and RSS results are reported separately; retries keep the original native request ID. Optional AI interpretation sends relevant content to the provider selected by the user.

Run the commands in the development section for tests, type checking, helper tests and a Chrome build. Firefox and Safari support is inherited but not validated for the Qiaomu-specific workflow. See [privacy](PRIVACY.md), [security reporting](SECURITY.md), and the original [MIT license](LICENSE). This independent project preserves the provenance of Obsidian Web Clipper.
