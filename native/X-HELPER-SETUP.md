# X 助手安装与发行

## 用户操作

X 完整阅读是可选功能。普通网页阅读、剪藏等操作不会自动安装 Grok，也不会自动检测 Grok 网络。

1. 需要读取 X 时，打开设置 →「可选功能」→「X 完整阅读」→「了解并设置」。在对话中处理 X 链接、遇到组件缺失或登录失效时，也会出现这个入口。
2. 查看用途、网络、Grok 账号与权限要求、当前系统的预计下载大小。可以选择「暂不启用」，其他功能继续正常使用。
3. 点「检查连接并设置」。只向 Grok 官方下载服务发起不携带 Cookie 的 HEAD 请求，最多 10 秒；不会下载组件。失败时保留在说明页，网络恢复后可重试。此检查不证明 X 正文可读或 Grok 账号有权限。
4. 按界面提示安装缺少的本地助手，然后按需下载 X 阅读组件（Grok），并在官方网页完成登录。已安装的组件直接复用。macOS 安装包为 `qiaomu-clipper-helper.pkg`，Windows 为对应架构的 `.exe`；均包含运行环境。
5. 从原请求进入设置时，点「继续原来的请求」，保留原问题的链接、翻译语言和要求。已有完整读取环境的用户仍可直接读取，无需重复安装。

安装包自带独立 Python；用户不需要安装 Python、配置 PATH 或输入命令。Windows 按当前用户安装，不需要管理员权限；macOS 使用系统安装器，会正常询问管理员密码。X 功能不要求配置 Obsidian。换电脑重复安装和网页登录，不复制账号凭据。

本地测试版安装包随交付文件夹提供。`src/utils/x-setup-release.ts` 的 `published: false` 会明确提示使用随版本提供的包，**不链接到缺少 X 功能的旧版 latest 包，也不构造未发布的下载入口**。

## 保留的读取与安全边界

- X 原始页面的结构化内容仍是正文来源；Grok 仅在需要时定位原帖。代码、图片、文章 ID、完整性和哈希核对保持原规则。
- `xSetupStatus/Start/Poll/Cancel` 只接收来自本扩展页面的固定操作 `install/login`，不接受命令、路径、下载地址、密钥或任意参数。
- Grok 1.0.41 是此前 X 链路验证过的版本。下载来源为官方 `x.ai/cli`，各平台的大小和 SHA256 固定在 `grok-runtime.json`；失败或取消不会覆盖原有 Grok 安装。升级固定版本应重新验证 X 链路。
- OAuth 由官方客户端打开浏览器；插件不读取、同步或展示凭据，助手丢弃登录进程输出。检测到可执行文件不代表订阅有效；真实读取时的登录错误会回到设置入口。
- 关闭窗口取消在该窗口启动的任务；重复打开可看到尚在运行的任务。安装和登录最多 10 分钟，自动检测最多 15 分钟，可以手动重试。
- Linux 保留原有源码安装和 X 读取能力，本次未提供 Linux 图形安装包。

## 构建与发行者步骤

构建机需要 Node、Python 3.12+；macOS 用系统 pkgbuild/productbuild，Windows 包可用跨平台 NSIS 构建。用户电脑不需要这些工具。

1. 使用 `scripts/pkg/fetch-runtime.py <platform>` 获取 `python-runtime-lock.json` 固定的四个平台运行环境。下载必须通过 SHA256 校验。
2. macOS：`scripts/pkg/build-pkg.sh --python-arm64 <runtime>/python --python-x86_64 <runtime>/python`。生产发行设置 `APP_SIGN_ID`、`INSTALLER_SIGN_ID` 和 `NOTARY_PROFILE`，完成 Developer ID 签名和公证。缺少签名的输出只能作为测试候选。
3. Windows：`python scripts/windows/build-installer.py --python <runtime>/python --arch x64 --output <output>`；ARM64 单独构建。再用发行者的 Authenticode 证书签名，记录签名后的 SHA256。
4. 在目标系统实测安装、自检、浏览器检测、Grok 安装和登录、真实 X 全文、失败重试和卸载。构建成功或单元测试不能代替目标系统验证。
5. 上传固定版本的签名安装包，核对下载地址、版本与 SHA256，再把 `x-setup-release.ts` 的仓库、tag 与 `published` 更新后发布扩展。不能先启用指向尚不存在或旧包的下载按钮。

普通用户流程以本页开头的界面操作为准；`install.py` 的命令参数留给开发和诊断。
