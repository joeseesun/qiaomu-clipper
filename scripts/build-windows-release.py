import os
import sys
import shutil
import zipfile
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf8')).get('version', '1.15.8')
PACKAGE_NAME = f"乔木剪藏-Windows发行版-v{VERSION}"
OUT_DIR = ROOT / "builds" / PACKAGE_NAME
ZIP_PATH = ROOT / "builds" / f"{PACKAGE_NAME}.zip"

def build():
    print(f"[*] 开始构建发行版：{PACKAGE_NAME}")
    
    # 1. 确保目标目录干净
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # 2. 复制浏览器扩展 (使用 dist_local，自带固定的扩展 ID 公钥)
    ext_src = ROOT / "dist_local"
    if not ext_src.exists():
        ext_src = ROOT / "dist"
    ext_dst = OUT_DIR / "1-浏览器扩展(解压加载版)"
    print(f"[*] 复制浏览器扩展文件夹：{ext_src} -> {ext_dst}")
    shutil.copytree(ext_src, ext_dst)
    
    # 3. 复制本地服务组件 (native/)
    native_dst = OUT_DIR / "2-本地服务组件(Native-Helper)"
    native_dst.mkdir(parents=True, exist_ok=True)
    native_src = ROOT / "native"
    files_to_copy = [
        "host.py",
        "asr.py",
        "asr_cloud.py",
        "asr_engines.py",
        "asr_runner.py",
        "asr_context.py",
        "install.py",
        "README.md"
    ]
    print(f"[*] 复制核心本地服务脚本...")
    for f in files_to_copy:
        src_file = native_src / f
        if src_file.exists():
            shutil.copy2(src_file, native_dst / f)
            
    # 4. 创建 一键安装本地服务(推荐).bat
    install_bat_content = r'''@echo off
chcp 65001 >nul
title 乔木剪藏 - 本地服务一键安装程序
cd /d "%~dp0"

echo ==========================================================
echo        乔木剪藏 (Qiaomu Clipper) 本地服务安装向导
echo ==========================================================
echo.

:: 1. 检查 Python 环境
echo [*] 正在检测系统 Python 环境...
set "PY_CMD="
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=python"
) else (
    py -3 --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    echo.
    echo ----------------------------------------------------------
    echo 【错误】未检测到 Python 3 环境！
    echo 乔木剪藏的音视频下载、字幕生成与免唤醒保存依赖 Python 3.9+。
    echo.
    echo 请前往 Python 官方网站下载安装 (推荐 3.10 / 3.11 / 3.12):
    echo https://www.python.org/downloads/
    echo.
    echo ⚠️ 重要提醒：安装程序启动时，请务必勾选最下方的
    echo    [√] Add python.exe to PATH (添加到环境变量)！
    echo ----------------------------------------------------------
    echo.
    echo 按任意键将自动打开 Python 官网下载页面...
    pause >nul
    start https://www.python.org/downloads/
    exit /b 1
)

echo [OK] 检测到 Python:
%PY_CMD% --version
echo.

:: 2. 安装/更新依赖
echo [*] 正在检查并安装必要运行库 (使用清华源加速)...
echo 正在安装 sherpa-onnx, soundfile, requests, yt-dlp...
%PY_CMD% -m pip install -U pip -i https://pypi.tuna.tsinghua.edu.cn/simple >nul 2>&1
%PY_CMD% -m pip install sherpa-onnx soundfile requests yt-dlp -i https://pypi.tuna.tsinghua.edu.cn/simple
if %errorlevel% neq 0 (
    echo.
    echo [提示] 清华源安装稍有延迟，正在尝试阿里云源备用通道...
    %PY_CMD% -m pip install sherpa-onnx soundfile requests yt-dlp -i https://mirrors.aliyun.com/pypi/simple/
)
echo.

:: 3. 运行原生注册程序
echo [*] 正在将本地助手注册到当前系统 (Edge / Chrome / Brave / Vivaldi)...
%PY_CMD% "2-本地服务组件(Native-Helper)\install.py" --extension-id jniolfihillilkoajpnonlbkhfkiicoo

if %errorlevel% neq 0 (
    echo.
    echo [错误] 本地助手注册未全部通过，请查看上方提示信息。
    pause
    exit /b 1
)

echo.
echo ==========================================================
echo                恭喜！本地服务安装与注册成功！
echo ==========================================================
echo.
echo 【下一步操作指引】：
echo 1. 打开您的浏览器 (Edge / Chrome / Brave 等)：
echo    - 访问 edge://extensions/ 或 chrome://extensions/
echo    - 打开右上角的「开发者模式」开关；
echo    - 点击「加载已解压的扩展程序」，选择本发行版下的：
echo      【1-浏览器扩展(解压加载版)】文件夹。
echo.
echo 2. 语音识别 (ASR) 模型说明：
echo    - 本发行版已去除庞大的模型包，做到极致轻量。
echo    - 当您在扩展设置中选择所需模型 (tiny / base / small) 时，
echo      插件会自动通过国内镜像源极速下载并缓存，无需手动配置！
echo.
echo 3. 享受视频号、B站、播客沉浸式转写与 Obsidian 丝滑剪藏吧！
echo ==========================================================
echo.
pause
'''
    (OUT_DIR / "一键安装本地服务(推荐).bat").write_text(install_bat_content, encoding='utf8')

    # 5. 创建 一键卸载本地服务.bat
    uninstall_bat_content = r'''@echo off
chcp 65001 >nul
title 乔木剪藏 - 一键卸载本地服务
cd /d "%~dp0"

echo ==========================================================
echo               乔木剪藏 本地服务卸载程序
echo ==========================================================
echo.
echo 即将清理本地注册表中的 NativeMessagingHosts 登记信息，
echo 并清理本地缓存脚本。
echo.
set /p confirm="确定要卸载吗？(Y/N): "
if /i not "%confirm%"=="Y" (
    echo 取消卸载。
    pause
    exit /b 0
)

echo.
echo [*] 正在清理注册表项...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\ai.qiaomu.clipper" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\ai.qiaomu.clipper" /f >nul 2>&1
reg delete "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\ai.qiaomu.clipper" /f >nul 2>&1

echo [*] 正在清理本地用户目录组件...
set "DATA_DIR=%USERPROFILE%\.local\share\qiaomu-clipper"
if exist "%DATA_DIR%" (
    rmdir /s /q "%DATA_DIR%"
)

echo.
echo [OK] 卸载完成！如果不再需要扩展，可直接在浏览器扩展管理页中点击移除。
pause
'''
    (OUT_DIR / "一键卸载本地服务.bat").write_text(uninstall_bat_content, encoding='utf8')

    # 6. 创建 环境检测与自检.bat
    check_bat_content = r'''@echo off
chcp 65001 >nul
title 乔木剪藏 - 环境自检
cd /d "%~dp0"

echo ==========================================================
echo                  乔木剪藏 运行环境自检
echo ==========================================================
echo.

set "PY_CMD="
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=python"
) else (
    py -3 --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    echo [×] 未检测到 Python 环境！
    pause
    exit /b 1
)

echo [√] Python 环境:
%PY_CMD% --version

echo.
echo [*] 正在运行本地助手自检程序...
%PY_CMD% "2-本地服务组件(Native-Helper)\install.py" --check
echo.
pause
'''
    (OUT_DIR / "环境检测与自检.bat").write_text(check_bat_content, encoding='utf8')

    # 7. 创建 使用说明与常见问题.txt
    readme_content = f"""乔木剪藏 (Qiaomu Clipper) Windows 发行版 v{VERSION}
============================================================

感谢使用乔木剪藏！本版本为 Windows 优化增强发行版，已包含最新的：
1. B站音视频自动合并为标准 H.264 MP4 视频，解决黑屏只有声音的问题；
2. 微信视频号（Channels）一键转写学习与下载支持；
3. 本地 Whisper 语音识别模型国内高速镜像自动下载与状态同步；
4. 免安装模型包：轻巧纯净（仅 16MB），无需手动搬运几十G的模型，按需极速拉取。

------------------------------------------------------------
【两步极速上手】
------------------------------------------------------------

第一步：加载浏览器扩展
1. 打开 Chrome、Edge、Brave 或其他 Chromium 内核浏览器；
2. 在地址栏输入并打开：
   - Chrome 用户: chrome://extensions/
   - Edge 用户: edge://extensions/
3. 打开右上角的【开发者模式】开关；
4. 点击左上角的【加载已解压的扩展程序】按钮；
5. 选中当前解压目录下的【1-浏览器扩展(解压加载版)】文件夹。
   （加载后扩展 ID 将固定为 jniolfihillilkoajpnonlbkhfkiicoo）

第二步：一键配置本地助手 (Native Messaging Host)
1. 双击运行当前目录下的【一键安装本地服务(推荐).bat】；
2. 程序会自动检查 Python 环境、自动安装依赖库（清华源加速），并写入注册表；
3. 提示成功后，刷新浏览器中的扩展或重新打开剪藏弹窗即可！

------------------------------------------------------------
【常见问题与解答】
------------------------------------------------------------
Q1: 提示“未检测到 Python 3 环境”？
A1: 请访问 https://www.python.org/downloads/ 下载安装 Python 3.10/3.11/3.12。
    ⚠️ 务必注意：安装首屏底部一定要勾选【Add python.exe to PATH】！

Q2: 模型在哪里？需要我手动下载吗？
A2: 完全不需要！本发行版特意移除了冗余的预置模型。
    在扩展的【设置 -> 语音识别(ASR)】中，点击你需要的模型版本（如 tiny、base、small），
    助手会自动通过国内高速镜像源实时下载，下载完成后立刻就能使用。

Q3: 如何转写微信视频号？
A3: 在浏览器中打开剪藏面板，点击右上角【...】更多菜单，进入【转写学习】；
    把视频号链接粘贴进去，根据提示点击“打开元宝并验证”（微信扫码登录一次元宝），
    即可自动开始下载视频并生成字幕文稿。

Q4: 如何卸载？
A4: 双击运行【一键卸载本地服务.bat】，并直接在浏览器扩展管理页中移除插件即可。
"""
    (OUT_DIR / "使用说明与常见问题.txt").write_text(readme_content, encoding='utf8')

    # 8. 打包为 zip
    print(f"[*] 正在打包为 ZIP 压缩包：{ZIP_PATH}")
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
        
    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(OUT_DIR):
            for file in files:
                abs_file = Path(root) / file
                rel_file = abs_file.relative_to(OUT_DIR.parent)
                zf.write(abs_file, rel_file)
                
    size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)
    print(f"[√] 发行版打包完成！")
    print(f"    - 解压版目录: {OUT_DIR}")
    print(f"    - ZIP 压缩包: {ZIP_PATH} ({size_mb:.2f} MB)")

if __name__ == "__main__":
    build()
