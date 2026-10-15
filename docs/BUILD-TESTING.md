# 开发、测试和发布

用户只使用一个测试入口：`~/Documents/乔木剪藏测试/extension`。worktree 是开发工具，不是用户安装入口。Chrome 日常资料保留商店正式版；专用测试资料只加载这个固定目录，不开启设置同步。

## 多 worktree 的功能交付

先按本次用户请求列出功能，再逐项核查来源工作区、提交和未提交改动，不能用“版本相同”“构建成功”或某个 PR 标题代替完整性检查。使用一个集成工作区收齐相关增量，保留其他线程原文件；旧分支的整文件不得覆盖较新主线修复。

`test-delivery.json` 记录本测试包承诺包含的功能、来源、必需文件和回归测试。`test:prepare` 在覆盖前检查文件、执行这些测试，并比较已安装包的功能清单；少任何已交付功能就拒绝覆盖，测试失败也保留原包。需要有意移除功能时先取得用户明确要求，再修改迁移流程，不提供跳过检查的常用开关。较老脚本尚不知道这道检查，所有交付工作区应先合入当前交付脚本，不能直接手工覆盖固定目录。

功能清单随实际安装记录写入 `CURRENT.json`、测试包的 `build-info.json` 和 `安装测试.md`。它不是功能发现器：新需求仍需负责集成的 agent 明确登记、审查来源并补测试。图片提取、向模型发送实际图片、真实模型回答分别验收；自动检查通过不替代浏览器重载与真实调用。

新功能开工先 `git fetch origin && npm run check:dev-base`；未包含最新远端主线或固定测试包提交时立即停止，在保留原改动的前提下选择最新集成基线。

准备前先读取固定目录的 `CURRENT.json`，以已安装版本和提交选择集成基线。旧 cwd 的功能清单相同也不能证明源码齐全；`test:prepare` 会拒绝版本降级或未包含已安装提交的构建。

## 给用户准备测试

```sh
npm run build:store
npm run test:prepare
```

默认测试商店版。仅测试独立版专属能力时：

```sh
npm run build:local
npm run test:prepare -- --edition local
```

两种版本都复制到同一个 `extension/`，不是指向 worktree 的软链接。上一份保留在同级 `previous/`。`CURRENT.json` 记录版本、源码提交、内容摘要和来源 worktree；普通构建不写测试入口。`QIAOMU_TEST_HOME` 可为自动验收选择独立绝对路径，通常不需要配置。

首次通过 Chrome 的“加载已解压的扩展程序”加载固定目录。之后由负责测试的 agent 重新加载扩展，刷新原页面，关闭旧阅读页后重新打开，并核对设置“关于”的版本身份。不得把文件准备完成说成已经安装或真实运行通过。

商店版测试副本只改 manifest 的 name、version_name、key，以及 build-info.json；脚本与资源保持生产构建原样。公钥维持既有商店 ID，让助手的来源授权正常工作。上传商店的原始包仍没有 key，也没有独立版权限与代码。生产构建不等于商店已上线。

浏览器测试资料不隔离 Native Messaging 助手、模型或真实笔记库。助手升级、真实保存、字幕生成需各自验收。系统密码、设备选择和要求人工处理的安全提示交给用户；不绕过系统保护。

## 目录约定

- `src/`、`native/`、`scripts/`、`assets/`、`xcode/`、`integration/`：源码及必要素材。
- `docs/`：长期文档、上架资料及公开网站。`docs/privacy.html` 等公开地址保持稳定。
- `build/dev/<target>/`：监听构建；不作为交付测试入口。
- `build/production/<target>/`：生产构建。target 为 chrome-store、chrome-local、firefox、safari。
- `build/cli/`：CLI/API 输出，扩展构建不得清理它。
- `build/cache/python/<release>/<version>/`：安装器运行时缓存。
- `build/tmp/`：临时组装；`build/qa/`：本地日志、截图和验收材料。
- `releases/<version>/<commit>-<source-hash>/`：不可覆盖的扩展包及校验文件。
- `releases/helper/<version>/<package-hash>/`：助手包及签名、公证检查记录。

`build/` 和 `releases/` 不进 Git。不要再创建 `builds/1.x-test`、带旧版本名的可变安装目录或把截图写进源码目录。每个 worktree 只构建自己的 build；跨 worktree 的测试准备有互斥锁，失败时不得自行删另一个任务的锁。

## 版本与归档

扩展版本唯一来源为 package.json，package-lock 同步。src 下的 manifest 是无 version 的构建模板，构建时注入版本。助手使用 native/VERSION，协议兼容性继续由已有 HELPER_PROTOCOL 判断，不能以扩展/助手版本号是否相等判断必须升级。

build-info.json 保存源码提交、工作区内容摘要、是否含未提交修改、目标、模式、时间及所有产物文件的 SHA-256。源码或产物在构建后改变时，测试准备和打包必须失败，不允许仅凭相同版本号放行。

```sh
npm test
npx tsc --noEmit
python3 -m unittest discover -s native -p 'test_*.py'
npm run build
npm run build:cli
npm run build:api
npm run package
```

build 只编译；package 才产生 ZIP。Chrome 两版打包前同时检查。只打 Chrome 可用 `npm run package -- --targets chrome-store,chrome-local`。`--release` 额外要求源码已提交，但仍不发布、不提交商店。

每个归档包含 SHA256SUMS 和 release.json。相同归档路径存在则报错；不得覆盖。交付验收后发布原包，不重新构建。不同平台构建需要相同源码身份。GitHub 发布、商店提交、审核上线分别取得证据，不从文件名推断。发布状态的后续记录放入发布说明/验收记录，不改已经验收的包。

## 历史目录迁移

现有主工作区有其他线程和已加载扩展；本次改造不会移动它们的 dist、builds 或 output。合并新流程后，负责迁移的 agent 应先查明浏览器加载路径并切到固定入口，核对历史包是否在远端归档、校验值是否一致，然后才迁移或清理。

保留当前正式版、前一可回退版、待验收/审核包。其余已核验远端备份的历史副本可清理；临时 QA 默认保留 30 天，故障与发布证据另行保留。output 中已跟踪素材逐项迁入 assets 或 docs，不能把整个目录当缓存删除。管理式 worktree 用 Codex 归档功能处理，不手动移动或删除。
