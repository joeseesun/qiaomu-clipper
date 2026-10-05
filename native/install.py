"""Install/update the native host. Run with no arguments: vault and extension ID are auto-detected.

Prints one JSON object on stdout; "ok": false carries "error" and "hint" an agent can act on.
"""
import argparse,json,os,re,struct,subprocess,sys
from pathlib import Path
HOME=Path.home()
# (label, user-data dir, NativeMessagingHosts dir) per Chromium-family browser.
if sys.platform=='darwin':
    S=HOME/'Library/Application Support'
    BROWSERS=[('Chrome',S/'Google/Chrome'),('Chrome Beta',S/'Google/Chrome Beta'),('Chrome Canary',S/'Google/Chrome Canary'),('Chromium',S/'Chromium'),('Edge',S/'Microsoft Edge'),('Brave',S/'BraveSoftware/Brave-Browser'),('Vivaldi',S/'Vivaldi'),('Arc',S/'Arc/User Data'),('Opera',S/'com.operasoftware.Opera')]
    HOSTS=lambda d:d/'NativeMessagingHosts'
elif sys.platform.startswith('linux'):
    C=HOME/'.config'
    BROWSERS=[('Chrome',C/'google-chrome'),('Chrome Beta',C/'google-chrome-beta'),('Chromium',C/'chromium'),('Edge',C/'microsoft-edge'),('Brave',C/'BraveSoftware/Brave-Browser'),('Vivaldi',C/'vivaldi')]
    HOSTS=lambda d:d/'NativeMessagingHosts'
elif sys.platform=='win32':
    L=Path(os.environ.get('LOCALAPPDATA',HOME/'AppData/Local'))
    BROWSERS=[('Chrome',L/'Google/Chrome/User Data'),('Chrome Beta',L/'Google/Chrome Beta/User Data'),('Chromium',L/'Chromium/User Data'),('Edge',L/'Microsoft/Edge/User Data'),('Brave',L/'BraveSoftware/Brave-Browser/User Data'),('Vivaldi',L/'Vivaldi/User Data')]
    # Windows has no per-browser manifest folder: one manifest, referenced from a registry key per browser vendor.
    HOSTS=lambda d:None
else: BROWSERS=[];HOSTS=None
REGISTRY={'Chrome':'Google\\Chrome','Chrome Beta':'Google\\Chrome','Chromium':'Chromium','Edge':'Microsoft\\Edge','Brave':'BraveSoftware\\Brave-Browser','Vivaldi':'Google\\Chrome'}
NAME='ai.qiaomu.clipper';BASE=HOME/'.local/share/qiaomu-clipper'
def fail(error,hint,**extra):
    print(json.dumps({'ok':False,'error':error,'hint':hint,**extra},ensure_ascii=False,indent=2));sys.exit(1)
def is_ours(entry):
    """Store installs carry the manifest name; unpacked ones point at a folder with manifest.json."""
    name=str((entry.get('manifest') or {}).get('name',''))
    if not name and entry.get('path') and Path(entry['path']).is_absolute():
        try: name=str(json.loads((Path(entry['path'])/'manifest.json').read_text(encoding='utf8')).get('name',''))
        except (OSError,ValueError): pass
    return '乔木剪藏' in name or 'qiaomu clipper' in name.lower()
def find_extensions():
    """-> {browser label: (user-data dir, [extension IDs])} for every browser profile that has the extension."""
    found={}
    for label,data in BROWSERS:
        ids=[]
        for prefs in sorted(data.glob('*/Secure Preferences'))+sorted(data.glob('*/Preferences')):
            try: settings=json.loads(prefs.read_text(encoding='utf8')).get('extensions',{}).get('settings',{})
            except (OSError,ValueError): continue
            ids+=[i for i,e in settings.items() if re.fullmatch('[a-p]{32}',i) and is_ours(e) and i not in ids]
        if ids: found[label]=(data,ids)
    return found
def find_vaults():
    for config in (HOME/'Library/Application Support/obsidian/obsidian.json',HOME/'.config/obsidian/obsidian.json',Path(os.environ.get('APPDATA',HOME/'AppData/Roaming'))/'obsidian/obsidian.json'):
        try: vaults=json.loads(config.read_text(encoding='utf8')).get('vaults',{}).values()
        except (OSError,ValueError): continue
        return [Path(v['path']) for v in sorted(vaults,key=lambda v:-v.get('ts',0)) if (Path(v.get('path',''))/'.obsidian').is_dir()]
    return []
def self_test(host,origin):
    """Speak the real native-messaging framing to the installed host, as Chrome would."""
    body=json.dumps({'action':'status'}).encode()
    r=subprocess.run([str(host),origin],input=struct.pack('=I',len(body))+body,capture_output=True,timeout=20)
    n=struct.unpack('=I',r.stdout[:4])[0] if len(r.stdout)>=4 else 0
    return json.loads(r.stdout[4:4+n]) if n else {'ok':False,'error':r.stderr.decode(errors='replace')[-300:] or 'host produced no reply'}
def register(label,data,manifest):
    """Make the browser find the host; return the file/key a person can inspect."""
    if sys.platform!='win32':
        d=HOSTS(data);d.mkdir(parents=True,exist_ok=True);m=d/f'{NAME}.json';m.write_text(json.dumps(manifest,indent=2),encoding='utf8');m.chmod(0o600);return str(m)
    import winreg
    m=BASE/f'{NAME}.json';m.write_text(json.dumps(manifest,indent=2),encoding='utf8')
    key='Software\\'+REGISTRY[label]+'\\NativeMessagingHosts\\'+NAME
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,key) as k: winreg.SetValueEx(k,'',0,winreg.REG_SZ,str(m))
    return 'HKCU\\'+key
def registered(label,data):
    """-> (where, allowed origins) or (where, None) when this browser has no registration."""
    if sys.platform!='win32':
        m=HOSTS(data)/f'{NAME}.json'
        return (str(m),json.loads(m.read_text(encoding='utf8')).get('allowed_origins',[])) if m.is_file() else (str(m),None)
    import winreg
    key='Software\\'+REGISTRY[label]+'\\NativeMessagingHosts\\'+NAME
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key) as k: m=Path(winreg.QueryValueEx(k,'')[0])
        return 'HKCU\\'+key,json.loads(m.read_text(encoding='utf8')).get('allowed_origins',[]) if m.is_file() else None
    except OSError: return 'HKCU\\'+key,None
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--vault');p.add_argument('--extension-id',action='append',default=[],help='repeatable; default: auto-detect');p.add_argument('--check',action='store_true',help='diagnose an existing install without changing anything')
    a=p.parse_args()
    if HOSTS is None: fail('此系统暂不支持','目前仅支持 macOS / Linux / Windows 的 Chromium 系浏览器（Chrome、Edge、Brave 等）')
    if sys.version_info<(3,9): fail(f'Python 版本过低（{sys.version.split()[0]}）','需要 Python 3.9 或更新版本，请用 python3.9+ 重新运行')
    detected=find_extensions()
    if a.check: return check(detected)
    ids=list(dict.fromkeys(a.extension_id))
    for i in ids:
        if not re.fullmatch('[a-p]{32}',i): fail(f'扩展 ID 格式无效：{i}','在 chrome://extensions 打开开发者模式，复制「乔木剪藏」卡片上的 32 位小写字母 ID')
    for _,(_,found) in detected.items(): ids+=[i for i in found if i not in ids]
    if not ids: fail('没有找到已安装的「乔木剪藏」扩展','请先在浏览器里安装并启用扩展（Chrome 应用商店或「加载已解压的扩展程序」），再重新运行；或用 --extension-id 手动指定',browsers_scanned=[b for b,_ in BROWSERS])
    if a.vault: vault=Path(a.vault).resolve()
    else:
        vaults=find_vaults()
        if not vaults: fail('没有找到 Obsidian 笔记库','请用 --vault /绝对路径 指定包含 .obsidian 文件夹的库目录')
        if len(vaults)>1: fail('找到多个 Obsidian 笔记库，无法判断用哪个','请询问用户要保存到哪一个，然后用 --vault 指定',vaults=[str(v) for v in vaults])
        vault=vaults[0].resolve()
    if not (vault/'.obsidian').is_dir(): fail(f'{vault} 不是 Obsidian 库（缺少 .obsidian）','请指定库的根目录')
    BASE.mkdir(parents=True,exist_ok=True)
    source=Path(__file__).with_name('host.py').read_text(encoding='utf8').split('\n',1)[1]
    script=BASE/'host.py';script.write_text('#!'+sys.executable+'\n'+source,encoding='utf8');script.chmod(0o700)
    host=script
    if sys.platform=='win32':
        # Chrome on Windows can't run a .py directly; it launches this wrapper, which forwards the origin argument.
        host=BASE/'host.bat';host.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n',encoding='utf8')
    # Subtitle generation (yt-dlp + ffmpeg + Whisper) lives next to the host; the host imports it from its own folder.
    for module in ('asr.py','asr_cloud.py','asr_engines.py','asr_runner.py','asr_context.py'): (BASE/module).write_text(Path(__file__).with_name(module).read_text(encoding='utf8'),encoding='utf8');(BASE/module).chmod(0o600)
    origins=[f'chrome-extension://{i}/' for i in ids]
    config=BASE/'config.json';config.write_text(json.dumps({'vault':str(vault),'origins':origins},ensure_ascii=False,indent=2),encoding='utf8');config.chmod(0o600)
    manifest={'name':NAME,'description':'Save clipped Markdown silently to the configured Obsidian vault','path':str(host),'type':'stdio','allowed_origins':origins}
    # Register for every browser that has the extension, plus Chrome if present (a not-yet-run profile may still need it).
    targets={label:data for label,(data,_) in detected.items()}
    for label,data in BROWSERS:
        if label=='Chrome' and data.is_dir(): targets.setdefault(label,data)
    if not targets: targets['Chrome']=BROWSERS[0][1]
    written={}
    for label,data in targets.items():
        written[label]=register(label,data,manifest)
    test=self_test(host,origins[0])
    if not test.get('ok'): fail('助手已安装，但自检未通过：'+str(test.get('error')),'按错误信息处理（例如库路径失效），再重新运行安装',host=str(host))
    print(json.dumps({'ok':True,'host':str(host),'vault':str(vault),'extensionIds':ids,'registeredFor':written,'selfTest':test,'next':'在浏览器扩展管理页重新加载「乔木剪藏」，再重新打开剪藏弹窗；无需重启浏览器'},ensure_ascii=False,indent=2))
def self_asr(host,origin):
    """Ask the installed host which of yt-dlp / ffmpeg / a Whisper engine are present (optional: only 生成字幕 needs them)."""
    body=json.dumps({'action':'asrStatus'}).encode()
    try:
        r=subprocess.run([str(host),origin],input=struct.pack('=I',len(body))+body,capture_output=True,timeout=20,env={'PATH':'/usr/bin:/bin'})
        n=struct.unpack('=I',r.stdout[:4])[0] if len(r.stdout)>=4 else 0
        answer=json.loads(r.stdout[4:4+n]) if n else {}
        return {k:answer.get(k) for k in ('ready','missing','hints','engine','modelDownloadNeeded')} if answer.get('ok') else {'ready':False,'error':answer.get('error','host produced no reply')}
    except Exception as e: return {'ready':False,'error':str(e)[:200]}
def check(detected):
    report={'python':sys.executable,'extension':{b:ids for b,(_,ids) in detected.items()}}
    host=BASE/('host.bat' if sys.platform=='win32' else 'host.py');cfg=BASE/'config.json'
    if not host.is_file() or not cfg.is_file(): fail('助手尚未安装','运行 python3 native/install.py（无需参数）',**report)
    config=json.loads(cfg.read_text(encoding='utf8'));origins=([config['origin']] if 'origin' in config else [])+list(config.get('origins',[]))
    problems=[]
    for label,(data,ids) in detected.items():
        where,allowed=registered(label,data)
        if allowed is None: problems.append(f'{label}：未注册（缺少 {where}）');continue
        for i in ids:
            if f'chrome-extension://{i}/' not in allowed: problems.append(f'{label}：扩展 ID {i} 不在允许列表（商店版与本地加载版 ID 不同）')
    if not detected: problems.append('没有在任何浏览器里找到「乔木剪藏」扩展')
    if not (BASE/'asr.py').is_file(): problems.append('缺少 asr.py（无字幕视频的「生成字幕」不可用）；重新运行 python3 native/install.py')
    test=self_test(host,origins[0]) if origins else {'ok':False,'error':'config 缺少扩展来源'}
    if not test.get('ok'): problems.append('助手自检失败：'+str(test.get('error')))
    asr_status=self_asr(host,origins[0]) if origins else None
    print(json.dumps({'ok':not problems,'problems':problems,'selfTest':test,'subtitleGeneration':asr_status,**report,'hint':'重新运行 python3 native/install.py 通常即可修复' if problems else '助手正常；若扩展仍提示未连接，请在扩展管理页重新加载扩展'},ensure_ascii=False,indent=2));sys.exit(1 if problems else 0)
main()
