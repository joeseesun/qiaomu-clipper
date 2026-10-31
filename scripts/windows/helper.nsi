Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "Qiaomu Clipper Helper ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\QiaomuClipper\${VERSION}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TEXT "$(FinishText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
LangString FinishText ${LANG_SIMPCHINESE} "助手已安装并完成自检，可以返回插件继续使用。需要 X 完整阅读时，在设置 → 可选功能中按需下载组件和登录。无需安装 Python 或输入命令。"
LangString FinishText ${LANG_ENGLISH} "The helper is installed and checked. Return to the extension. For full X reading, open Settings > Optional features to download its component and sign in when needed. No Python installation or commands are needed."
LangString FailedText ${LANG_SIMPCHINESE} "助手注册或自检未通过。请关闭安装器后重新安装。诊断记录保存在安装目录的 install.log。"
LangString FailedText ${LANG_ENGLISH} "Registration or the helper check failed. Close this installer and try again. Diagnostics are saved as install.log in the installation folder."
LangString UninstallFailedText ${LANG_SIMPCHINESE} "助手尚未卸载。请先完成或取消正在进行的生成、下载或组件安装，然后重试。详细记录保存在安装目录的 uninstall.log。"
LangString UninstallFailedText ${LANG_ENGLISH} "The helper has not been removed. Complete or cancel active generation, downloads or component installation, then try again. See uninstall.log in the installation folder."
Section "Install"
  SetOutPath "$INSTDIR\runtime"
  File /r "${PYTHON}/*"
  SetOutPath "$INSTDIR\native"
  File "${NATIVE}/*"
  nsExec::Exec /TIMEOUT=300000 '"$INSTDIR\runtime\python.exe" -X utf8 "$INSTDIR\native\installer.py" install'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "$(FailedText)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiaomuClipperHelper" "DisplayName" "Qiaomu Clipper Helper"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiaomuClipperHelper" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiaomuClipperHelper" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  nsExec::Exec /TIMEOUT=60000 '"$INSTDIR\runtime\python.exe" -X utf8 "$INSTDIR\native\installer.py" uninstall'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "$(UninstallFailedText)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiaomuClipperHelper"
  RMDir /r "$INSTDIR"
SectionEnd
