#!/usr/bin/env python3
"""Move the extension's saved data from an old (path-based) extension ID to the fixed ID, with a backup first.

Why: the local (unpacked) build used to get a different extension ID on every computer. The `-chrome-local` build has a fixed ID
(the Web Store's), and Chrome keeps each extension's data under its own ID. This copies everything the extension saved
(settings, API keys, chat history, highlights, drafts) from the old ID to the new one.

  python3 scripts/migrate-extension-data.py --dry-run     show what would happen, change nothing
  python3 scripts/migrate-extension-data.py               back up, then copy
  python3 scripts/migrate-extension-data.py --restore DIR put a backup back

Chrome must be fully quit (Cmd+Q) first: it holds these folders open. Prints one JSON object; "ok": false carries "error"/"hint".
Supports macOS and Linux. Nothing is deleted: the old ID's data stays where it is.
"""
import argparse,json,os,re,shutil,subprocess,sys,time
from pathlib import Path
HOME=Path.home()
NEW_ID='jniolfihillilkoajpnonlbkhfkiicoo'
if sys.platform=='darwin':
    S=HOME/'Library/Application Support'
    BROWSERS=[('Chrome',S/'Google/Chrome','Google Chrome'),('Chrome Beta',S/'Google/Chrome Beta','Google Chrome Beta'),('Chromium',S/'Chromium','Chromium'),('Edge',S/'Microsoft Edge','Microsoft Edge'),('Brave',S/'BraveSoftware/Brave-Browser','Brave Browser'),('Vivaldi',S/'Vivaldi','Vivaldi'),('Arc',S/'Arc/User Data','Arc')]
else:
    C=HOME/'.config'
    BROWSERS=[('Chrome',C/'google-chrome','chrome'),('Chromium',C/'chromium','chromium'),('Edge',C/'microsoft-edge','msedge'),('Brave',C/'BraveSoftware/Brave-Browser','brave'),('Vivaldi',C/'vivaldi','vivaldi')]
# Folders a Chrome profile keeps per extension ID.
KINDS=[('Local Extension Settings','{id}'),('Sync Extension Settings','{id}'),('IndexedDB','chrome-extension_{id}_0.indexeddb.leveldb'),('IndexedDB','chrome-extension_{id}_0.indexeddb.blob')]
def fail(error,hint,**extra):
    print(json.dumps({'ok':False,'error':error,'hint':hint,**extra},ensure_ascii=False,indent=2));sys.exit(1)
def is_ours(entry):
    name=str((entry.get('manifest') or {}).get('name',''))
    if not name and entry.get('path') and Path(entry['path']).is_absolute():
        try: name=str(json.loads((Path(entry['path'])/'manifest.json').read_text(encoding='utf8')).get('name',''))
        except (OSError,ValueError): pass
    return '乔木剪藏' in name or 'qiaomu clipper' in name.lower()
def old_ids(profile):
    found=[]
    for f in (profile/'Secure Preferences',profile/'Preferences'):
        try: settings=json.loads(f.read_text(encoding='utf8')).get('extensions',{}).get('settings',{})
        except (OSError,ValueError): continue
        found+=[i for i,e in settings.items() if re.fullmatch('[a-p]{32}',i) and i!=NEW_ID and is_ours(e) and i not in found]
    return found
def running(process_name):
    if sys.platform=='darwin': cmd=['pgrep','-x',process_name]
    else: cmd=['pgrep','-x',process_name]
    return subprocess.run(cmd,capture_output=True).returncode==0
def size(path):
    return sum(f.stat().st_size for f in path.rglob('*') if f.is_file()) if path.is_dir() else 0
def plan(only_from):
    jobs=[]
    for label,data,process in BROWSERS:
        if not data.is_dir(): continue
        for profile in sorted(p for p in data.iterdir() if p.is_dir() and (p/'Preferences').is_file()):
            for old in ([only_from] if only_from else old_ids(profile)):
                copies=[]
                for folder,pattern in KINDS:
                    src=profile/folder/pattern.format(id=old);dst=profile/folder/pattern.format(id=NEW_ID)
                    if src.is_dir(): copies.append({'from':str(src),'to':str(dst),'bytes':size(src),'targetExists':dst.exists() and any(dst.iterdir())})
                if copies: jobs.append({'browser':label,'process':process,'profile':profile.name,'oldId':old,'copies':copies})
    return jobs
def main():
    p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--from',dest='old',help='old extension ID (default: find it)');p.add_argument('--dry-run',action='store_true');p.add_argument('--force',action='store_true',help='overwrite data already under the new ID (it is backed up first)');p.add_argument('--restore',metavar='BACKUP_DIR');p.add_argument('--user-data-dir',help='a browser data folder that is not in the usual place (for example a custom Chromium profile)');p.add_argument('--process-name',help='process name to check is not running (with --user-data-dir)')
    a=p.parse_args()
    if sys.platform not in ('darwin',) and not sys.platform.startswith('linux'): fail('此系统暂不支持','目前支持 macOS 和 Linux')
    if a.old and not re.fullmatch('[a-p]{32}',a.old): fail(f'扩展 ID 格式无效：{a.old}','在 chrome://extensions 复制旧版「乔木剪藏」卡片上的 32 位 ID')
    if a.user_data_dir:
        global BROWSERS
        BROWSERS=[('Custom',Path(a.user_data_dir).expanduser(),a.process_name or 'Google Chrome')]
    if a.restore: return restore(Path(a.restore))
    jobs=plan(a.old)
    if not jobs: fail('没有找到旧版扩展的数据','可能已经迁移过，或旧版用的是别的浏览器；也可以用 --from 旧ID 指定')
    busy=sorted({j['browser'] for j in jobs if running(j['process'])})
    if busy and not a.dry_run: fail('浏览器还在运行：'+'、'.join(busy),'请先完全退出（macOS 按 Cmd+Q，不是只关窗口），再重新运行；Chrome 开着时复制会得到损坏的数据',jobs=jobs)
    clash=[j for j in jobs if any(c['targetExists'] for c in j['copies'])]
    if clash and not a.force and not a.dry_run: fail('新 ID 下已经有数据（可能已经用过新版）','确认要覆盖就加 --force，覆盖前会先备份新 ID 现有的数据',jobs=jobs)
    if a.dry_run: print(json.dumps({'ok':True,'dryRun':True,'browsersRunning':busy,'jobs':jobs,'next':'去掉 --dry-run 正式执行'},ensure_ascii=False,indent=2));return
    backup=HOME/('qiaomu-clipper-backup-'+time.strftime('%Y%m%d-%H%M%S'));done=[]
    for j in jobs:
        for c in j['copies']:
            for label,path in (('old',c['from']),('new',c['to'])):
                path=Path(path)
                if path.is_dir() and any(path.iterdir()):
                    dest=backup/j['browser']/j['profile']/label/path.parent.name/path.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(path,dest)
    (backup).mkdir(parents=True,exist_ok=True);(backup/'manifest.json').write_text(json.dumps({'newId':NEW_ID,'jobs':jobs},ensure_ascii=False,indent=2),encoding='utf8')
    for j in jobs:
        for c in j['copies']:
            dst=Path(c['to'])
            if dst.exists(): shutil.rmtree(dst)
            shutil.copytree(c['from'],dst);done.append(c['to'])
    print(json.dumps({'ok':True,'backup':str(backup),'copied':len(done),'jobs':jobs,'next':'打开浏览器，在 chrome://extensions 删除旧版（可选）并加载 -chrome-local 版；设置和数据会在新版里原样出现。出问题可用 --restore 备份目录 恢复'},ensure_ascii=False,indent=2))
def restore(backup):
    info=backup/'manifest.json'
    if not info.is_file(): fail('这不是迁移备份目录','备份目录里应有 manifest.json')
    jobs=json.loads(info.read_text(encoding='utf8'))['jobs']
    busy=sorted({j['browser'] for j in jobs if running(j['process'])})
    if busy: fail('浏览器还在运行：'+'、'.join(busy),'请先完全退出再恢复')
    n=0
    for j in jobs:
        for c in j['copies']:
            src_new=backup/j['browser']/j['profile']/'new'/Path(c['to']).parent.name/Path(c['to']).name
            dst=Path(c['to'])
            if dst.exists(): shutil.rmtree(dst)
            if src_new.is_dir(): shutil.copytree(src_new,dst)
            n+=1
    print(json.dumps({'ok':True,'restored':n,'note':'新 ID 下的数据已恢复到迁移前的样子；旧 ID 的数据从未被改动'},ensure_ascii=False,indent=2))
main()
