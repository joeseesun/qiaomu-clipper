"""Remove the helper's registrations, private environments, user folder and installed package.

Used by the extension's "卸载助手" button (through host.py) and by `qiaomu-helper --uninstall`.
Never touches notes, the Obsidian vault, or models other tools downloaded into the shared Hugging Face cache.
"""
import json,os,re,shutil,subprocess,sys
from pathlib import Path
HOME=Path.home()
NAME='ai.qiaomu.clipper'
BASE=Path(os.environ.get('QIAOMU_BASE') or HOME/'.local/share/qiaomu-clipper')
SYSTEM_ROOT=Path(os.environ.get('QIAOMU_INSTALL_ROOT') or '/Library/QiaomuClipper')
PKG_ID='ai.qiaomu.clipper.helper'
WINDOWS_KEYS=['Google\\Chrome','Chromium','Microsoft\\Edge','BraveSoftware\\Brave-Browser']
WINDOWS_UNINSTALL_KEY='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QiaomuClipperHelper'

def windows_package():
    """Only launch our registered per-user installer, never an arbitrary registry command."""
    if sys.platform!='win32': return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,WINDOWS_UNINSTALL_KEY) as key:
            command=winreg.QueryValueEx(key,'UninstallString')[0]
        if not isinstance(command,str): return None
        match=re.fullmatch(r'"([^"\r\n]+)"',command)
        if not match: return None
        target=Path(match[1]).resolve()
        root=(Path(os.environ['LOCALAPPDATA'])/'QiaomuClipper').resolve()
        if target.name.lower()!='uninstall.exe' or target.parent.parent!=root or not re.fullmatch(r'\d+\.\d+\.\d+',target.parent.name): return None
        return target if target.is_file() else None
    except (ImportError,OSError,KeyError,ValueError): return None

def busy():
    import asr,codex_images,x_articles,x_setup
    return bool(asr.active_job(BASE)[0] or asr.active_install(BASE)[0] or codex_images.active_job(BASE) or x_articles.active_job(BASE) or x_setup.active_job(BASE))

def manifests():
    """Every NativeMessagingHosts/<NAME>.json that is ours, in any Chromium-family browser profile folder."""
    roots=[]
    if sys.platform=='darwin': roots=[HOME/'Library/Application Support']
    elif sys.platform.startswith('linux'): roots=[HOME/'.config']
    found=[]
    for root in roots:
        for pattern in ('*/NativeMessagingHosts','*/*/NativeMessagingHosts'): found+=sorted(root.glob(pattern+'/'+NAME+'.json'))
    ours=[]
    for path in found:
        try:
            if json.loads(path.read_text(encoding='utf8')).get('name')==NAME: ours.append(path)
        except (OSError,ValueError): continue
    return ours

def folder_bytes(folder):
    total=0
    for dirpath,_,files in os.walk(folder):
        for name in files:
            try: total+=os.lstat(os.path.join(dirpath,name)).st_size
            except OSError: pass
    return total

def engine_models():
    """Model caches are shared; supporting a model does not establish ownership."""
    return []

def plan():
    """What would go, and how much space it frees. Reads only."""
    models=[m for m in engine_models() if m.is_dir()]
    size=folder_bytes(BASE) if BASE.is_dir() else 0
    size+=sum(folder_bytes(m) for m in models)
    system=sys.platform=='darwin' and SYSTEM_ROOT.is_dir()
    if system: size+=folder_bytes(SYSTEM_ROOT)
    package=windows_package()
    if package: size+=folder_bytes(package.parent)
    return {'registrations':[str(p) for p in manifests()],'user':str(BASE) if BASE.is_dir() else None,'models':[str(m) for m in models],'system':str(SYSTEM_ROOT) if system else None,'windowsPackage':str(package.parent) if package else None,'systemUninstallerAvailable':bool(package),'freedMb':round(size/1048576),'needsAdmin':system,'preservesSharedModels':True}

def remove_system():
    """Delete the installed package files with the standard macOS password dialog. -> (done, cancelled, message)"""
    if sys.platform!='darwin' or not SYSTEM_ROOT.is_dir(): return True,False,''
    if os.access(SYSTEM_ROOT.parent,os.W_OK) and os.geteuid()==0:
        shutil.rmtree(SYSTEM_ROOT,ignore_errors=True);subprocess.run(['pkgutil','--forget',PKG_ID],capture_output=True);return True,False,''
    if os.environ.get('QIAOMU_UNINSTALL_NO_ADMIN'): return True,False,'skipped'
    command=f'rm -rf {shell_quote(str(SYSTEM_ROOT))} && (pkgutil --forget {PKG_ID} >/dev/null 2>&1 || true)'
    script='do shell script "'+command.replace('\\','\\\\').replace('"','\\"')+'" with administrator privileges with prompt "卸载乔木剪藏助手需要管理员权限"'
    r=subprocess.run(['osascript','-e',script],capture_output=True,text=True,timeout=600)
    if r.returncode==0: return True,False,''
    return False,'-128' in r.stderr or 'User canceled' in r.stderr,r.stderr.strip()[-200:]

def shell_quote(value): return "'"+value.replace("'","'\\''")+"'"

def remove_user():
    for path in manifests():
        try: path.unlink()
        except OSError: pass
    if sys.platform=='win32':
        try:
            import winreg
            for vendor in WINDOWS_KEYS:
                try: winreg.DeleteKey(winreg.HKEY_CURRENT_USER,'Software\\'+vendor+'\\NativeMessagingHosts\\'+NAME)
                except OSError: pass
        except ImportError: pass
    shutil.rmtree(BASE,ignore_errors=True)

def run(from_package=False):
    """Do it. The password dialog comes first so a cancelled dialog leaves a working helper behind."""
    found=plan()
    package=windows_package()
    if package and not from_package:
        # The native host must exit before Windows can delete its Python runtime.
        # Hand over to the normal GUI; cancellation leaves the helper untouched.
        subprocess.Popen([str(package)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True)
        return {'ok':True,'pending':True,'systemUninstaller':True}
    if from_package and busy(): return {'ok':False,'error':'正在生成内容或安装组件，请完成或取消任务后再卸载。'}
    done,cancelled,message=remove_system()
    if not done: return {'ok':False,'cancelled':cancelled,'error':'没能删除系统里的助手文件：'+message if not cancelled else '已取消'}
    remove_user()
    return {'ok':True,'freedMb':found['freedMb'],'left':[str(p) for p in manifests()]+([str(BASE)] if BASE.exists() else [])}

if __name__=='__main__':
    if '--plan' in sys.argv: print(json.dumps(plan(),ensure_ascii=False,indent=2));sys.exit(0)
    result=run(from_package='--from-package' in sys.argv);print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(0 if result['ok'] else 1)
