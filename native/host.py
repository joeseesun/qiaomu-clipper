#!/usr/bin/env python3
"""Chrome native host: write Markdown only inside the explicitly configured vault."""
import base64, datetime, hashlib, json, os, re, shutil, struct, subprocess, sys, tempfile, time, uuid
from pathlib import Path
try: import fcntl
except ImportError: fcntl=None  # Windows
if fcntl is None: import msvcrt
def lock_exclusive(f):
    if fcntl: fcntl.flock(f,fcntl.LOCK_EX)
    else: f.seek(0);msvcrt.locking(f.fileno(),msvcrt.LK_LOCK,1)
MAX_BYTES = 4 * 1024 * 1024
# Attachments: files are staged here when added to the note card and only copied into the vault when the note is saved.
MAX_ATTACHMENT = 2 * 1024 ** 3
MAX_STAGE_BYTES = 6 * 1024 * 1024
MAX_ATTACHMENTS = 20
STAGE_TTL = 14 * 86400
MAX_REQUEST = 9 * 1024 * 1024
KIND_EXTENSIONS = {'image':{'png','jpg','jpeg','gif','webp','svg','avif','bmp'},'video':{'mkv','mov','mp4','ogv','webm'},'audio':{'flac','m4a','mp3','ogg','wav','3gp'},'pdf':{'pdf'}}
BEHAVIORS = {'create','append-specific','prepend-specific','append-daily','prepend-daily','overwrite'}
def atomic_json(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf8') as f: json.dump(data,f,ensure_ascii=False); f.flush(); os.fsync(f.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)
def relative_path(value):
    if not isinstance(value,str) or '\\' in value or '\x00' in value: raise ValueError('笔记路径无效')
    p=Path(value)
    if p.is_absolute() or any(x.startswith('.') or x in {'..',''} for x in p.parts): raise ValueError('笔记必须保存在所选库内的普通文件夹')
    return p
def destination(root, folder, name):
    p = root / relative_path(folder) / relative_path(name)
    if p.suffix.lower() != '.md': raise ValueError('只支持 Markdown 笔记')
    if not p.resolve().is_relative_to(root): raise ValueError('笔记路径超出了所选库')
    return p
def daily_target(root):
    config=root/'.obsidian/daily-notes.json'
    data=json.loads(config.read_text(encoding='utf8')) if config.exists() else {}
    if data.get('template'): raise ValueError('配置了日记模板，请使用“添加到 Obsidian”以保留模板行为')
    pattern=data.get('format') or 'YYYY-MM-DD'
    # Keep date interpretation explicit; unsupported Moment formats never save to the wrong day.
    if re.search(r'[^YMD/._ -]',pattern): raise ValueError('当前日记格式暂不支持静默保存，请使用 YYYY-MM-DD')
    now=datetime.datetime.now()
    values={'YYYY':f'{now.year:04}','YY':f'{now.year%100:02}','MM':f'{now.month:02}','M':str(now.month),'DD':f'{now.day:02}','D':str(now.day)}
    name=re.sub(r'(?<!Y)(YYYY|YY)(?!Y)|(?<!M)(MM|M)(?!M)|(?<!D)(DD|D)(?!D)',lambda m:values[m.group()],pattern)+'.md'
    if re.search('[YMD]',name): raise ValueError('当前日记格式暂不支持静默保存，请使用 YYYY-MM-DD')
    return destination(root,data.get('folder') or '',name)
def vault_directory(value):
    if not isinstance(value,str) or not value.strip() or '\x00' in value or not Path(value).is_absolute(): raise ValueError('请输入笔记库的完整文件夹路径')
    selected=Path(value).resolve()
    if not selected.is_dir() or not (selected/'.obsidian').is_dir(): raise ValueError('该文件夹不是已有的 Obsidian 笔记库，请选择包含 .obsidian 的库目录')
    return selected
def choose_vault(initial=None, prompt='请选择 Obsidian 笔记库文件夹（包含 .obsidian 的目录）'):
    if sys.platform=='darwin':
        script='on run argv\nactivate\nreturn POSIX path of (choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv)))\nend run'
        start=Path(initial) if initial and Path(initial).is_dir() else Path.home()
        result=subprocess.run(['/usr/bin/osascript','-e',script,str(start),prompt],capture_output=True,text=True)
        if result.returncode:
            if '(-128)' in result.stderr: return None
            raise ValueError('无法打开文件夹选择器，请手动填写库地址')
        return result.stdout.rstrip('\n')
    try:
        import tkinter
        from tkinter import filedialog
        window=tkinter.Tk();window.withdraw()
        try: return filedialog.askdirectory(title=prompt,initialdir=initial or str(Path.home()),mustexist=True) or None
        finally: window.destroy()
    except Exception as e: raise ValueError('此系统无法打开文件夹选择器，请手动填写库地址') from e

def learning_daily_target(root, vault=''):
    if vault and vault not in {root.name,str(root)}: raise ValueError('所选库与本地助手配置不一致，请先切换库')
    date=datetime.datetime.now().strftime('%Y-%m-%d')
    config=root/'.obsidian/daily-notes.json'
    if not config.is_file(): return {'status':'unsupported','vault':root.name,'date':date,'error':'当前库尚未配置日记，无法确认今日日记位置'}
    try:
        target=daily_target(root)
    except (ValueError,json.JSONDecodeError) as error:
        return {'status':'unsupported','vault':root.name,'date':date,'error':str(error)}
    token=hashlib.sha256((str(root)+'\n'+str(target)+'\n'+date).encode()).hexdigest()
    return {'status':'ready','vault':root.name,'date':date,'relativePath':target.relative_to(root).as_posix(),'targetToken':token}


# ---- Attachments -------------------------------------------------------------------------------------------------
# Adding a file only stages a copy under the helper's own folder (a clone on APFS, so even a large video is instant).
# Saving the note then copies the staged files into the vault's attachment folder BEFORE the diary entry is written,
# so a failed copy never leaves a link to a file that is not there.
def attachment_kind(name):
    ext=Path(name).suffix.lower().lstrip('.')
    return next((kind for kind,exts in KIND_EXTENSIONS.items() if ext in exts),'other')
def clean_name(name):
    name=os.path.basename(str(name or '').replace('\\','/'))
    name=re.sub(r'[\x00-\x1f\x7f\[\]#^|\\/:*?"<>]','-',name).strip().lstrip('.')
    path=Path(name); stem=path.stem.strip() or 'attachment'; ext=path.suffix[:16]
    while len((stem+ext).encode('utf8'))>180 and len(stem)>1: stem=stem[:-1]
    return stem+ext
def file_sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1<<20),b''): digest.update(chunk)
    return digest.hexdigest()
def clone_or_copy(source,destination):
    if sys.platform=='darwin' and subprocess.run(['/bin/cp','-c',str(source),str(destination)],capture_output=True).returncode==0: return
    if os.path.lexists(destination): os.unlink(destination)
    shutil.copyfile(source,destination)
def make_thumb(path,kind):
    if kind!='image' or sys.platform!='darwin' or path.suffix.lower()=='.svg': return None
    folder=Path(tempfile.mkdtemp()); out=folder/'t.jpg'
    try:
        result=subprocess.run(['/usr/bin/sips','-Z','192','-s','format','jpeg',str(path),'--out',str(out)],capture_output=True,timeout=15)
        if result.returncode or not out.is_file() or out.stat().st_size>80000: return None
        return 'data:image/jpeg;base64,'+base64.b64encode(out.read_bytes()).decode()
    except Exception: return None
    finally: shutil.rmtree(folder,ignore_errors=True)
def prune_staging(base):
    folder=base/'staging'; cutoff=time.time()-STAGE_TTL
    if not folder.is_dir(): return
    for entry in folder.iterdir():
        try:
            if entry.stat().st_mtime<cutoff: shutil.rmtree(entry,ignore_errors=True)
        except OSError: pass
def discard_staging(base,ids):
    for attachment_id in ids:
        if isinstance(attachment_id,str) and re.fullmatch(r'[0-9a-f]{32}',attachment_id): shutil.rmtree(base/'staging'/attachment_id,ignore_errors=True)
def stage_file(base,source,name=None):
    source=Path(source).resolve()
    if not source.is_file(): raise ValueError('找不到文件：'+source.name)
    clean=clean_name(name or source.name); size=source.stat().st_size
    if size==0: raise ValueError(clean+' 是空文件')
    if size>MAX_ATTACHMENT: raise ValueError(clean+' 超过 2 GB，请手动放入库中')
    attachment_id=uuid.uuid4().hex; folder=base/'staging'/attachment_id; folder.mkdir(parents=True,mode=0o700)
    try:
        data=folder/('data'+Path(clean).suffix.lower()); clone_or_copy(source,data)
        if data.stat().st_size!=size: raise ValueError(clean+' 在复制时发生变化，请重试')
        kind=attachment_kind(clean)
        atomic_json(folder/'meta.json',{'name':clean,'size':size,'sha256':file_sha(data),'file':data.name,'kind':kind})
        return {'id':attachment_id,'name':clean,'size':size,'kind':kind,'thumb':make_thumb(data,kind),'origName':source.name,'origSize':size}
    except BaseException:
        shutil.rmtree(folder,ignore_errors=True); raise
def run_osascript(script,args=(),language=None):
    if sys.platform!='darwin': raise ValueError('此系统暂不支持从本机选择附件')
    command=['/usr/bin/osascript']+(['-l',language] if language else [])+['-e',script,*map(str,args)]
    return subprocess.run(command,capture_output=True,text=True)
SEPARATOR='\x1e'
def pick_files():
    script='on run argv\nactivate\nset chosen to choose file with prompt (item 1 of argv) with multiple selections allowed\nset out to {}\nrepeat with f in chosen\nset end of out to POSIX path of f\nend repeat\nset AppleScript\'s text item delimiters to (ASCII character 30)\nreturn out as text\nend run'
    result=run_osascript(script,['请选择要加入笔记的附件'])
    if result.returncode:
        if '(-128)' in result.stderr: return None
        raise ValueError('无法打开文件选择器')
    return [x for x in result.stdout.rstrip('\n').split(SEPARATOR) if x]
def clipboard_files():
    script='ObjC.import("AppKit");function run(){var pb=$.NSPasteboard.generalPasteboard;var opts=$.NSDictionary.dictionaryWithObjectForKey($(true),"NSPasteboardURLReadingFileURLsOnlyKey");var urls=pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL),opts);var out=[];if(urls&&urls.count)for(var i=0;i<urls.count;i++)out.push(ObjC.unwrap(urls.objectAtIndex(i).path));return JSON.stringify(out);}'
    result=run_osascript(script,language='JavaScript')
    if result.returncode: raise ValueError('无法读取剪贴板里的文件')
    return json.loads(result.stdout or '[]')
def finder_files():
    script='tell application "Finder"\nset sel to selection as alias list\nset out to {}\nrepeat with f in sel\nset end of out to POSIX path of f\nend repeat\nend tell\nset AppleScript\'s text item delimiters to (ASCII character 30)\nreturn out as text'
    result=run_osascript(script)
    if result.returncode: raise ValueError('无法读取 Finder 中选中的文件，请在系统设置里允许自动化控制 Finder')
    return [x for x in result.stdout.rstrip('\n').split(SEPARATOR) if x]
def attach(message,base):
    action=message.get('action'); (base/'staging').mkdir(parents=True,exist_ok=True,mode=0o700)
    if action=='attachDiscard':
        discard_staging(base,message.get('ids') or []); return {'ok':True}
    prune_staging(base); items=[]; errors=[]
    if action=='attachBytes':
        name=clean_name(message.get('name')); raw=message.get('data')
        try: data=base64.b64decode(raw,validate=True) if isinstance(raw,str) else b''
        except ValueError: data=b''
        if not data or len(data)>MAX_STAGE_BYTES: raise ValueError('文件为空或超过 6 MB，请用“添加附件”选择本机文件')
        folder=Path(tempfile.mkdtemp(dir=base/'staging',prefix='.in-'))
        try:
            temp=folder/'in'; temp.write_bytes(data); items.append(stage_file(base,temp,name))
        finally: shutil.rmtree(folder,ignore_errors=True)
        return {'ok':True,'items':items}
    if action=='attachPick': paths=pick_files()
    elif action=='attachLocal':
        paths=clipboard_files() if message.get('source')=='clipboard' else finder_files()
        wanted=[(str(x.get('name')),x.get('size')) for x in (message.get('names') or []) if isinstance(x,dict)]
        # Only the files the page actually received: the clipboard or Finder selection may hold others.
        if wanted: paths=[x for x in paths if any(Path(x).name==n and (s is None or (Path(x).is_file() and Path(x).stat().st_size==s)) for n,s in wanted)]
    else: raise ValueError('不支持的本地操作')
    if paths is None: return {'ok':False,'cancelled':True}
    for path in paths[:MAX_ATTACHMENTS]:
        try: items.append(stage_file(base,path))
        except (ValueError,OSError) as error: errors.append(str(error))
    return {'ok':True,'items':items,'errors':errors}
def attachment_dir(root,note_dir):
    config=root/'.obsidian/app.json'
    try: setting=json.loads(config.read_text(encoding='utf8')).get('attachmentFolderPath') if config.exists() else None
    except (ValueError,OSError,AttributeError): setting=None
    setting=setting.strip() if isinstance(setting,str) else '/'
    if setting in ('','/'): folder=root
    elif setting=='.' or setting=='./': folder=note_dir
    elif setting.startswith('./'): folder=note_dir/setting[2:]
    else: folder=root/setting.strip('/')
    folder=Path(os.path.normpath(folder))
    if not folder.is_relative_to(root) or any(part.startswith('.') for part in folder.relative_to(root).parts): raise ValueError('Obsidian 附件文件夹设置无效，请检查“文件与链接”设置')
    return folder
def publish_file(data,final):
    temp=final.with_name('.qiaomu-'+uuid.uuid4().hex+'.part')
    try:
        clone_or_copy(data,temp)
        if temp.stat().st_size!=data.stat().st_size: raise OSError('复制不完整')
        fd=os.open(temp,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        try: os.link(temp,final)
        except FileExistsError: return False
        except OSError:
            if os.path.lexists(final): return False
            os.rename(temp,final)
        return True
    finally:
        if os.path.lexists(temp): os.unlink(temp)
def marker(attachment_id): return '\u27e6att:'+attachment_id+'\u27e7'
def link_text(relative,name):
    # A vault-relative path stays unambiguous when the same file name exists elsewhere in the vault.
    target=relative if not re.search(r'[\[\]#^|]',relative) else name
    return '![['+target+']]' if attachment_kind(name)!='other' else '[['+target+'|'+name+']]'
def commit_attachments(root,base,note_dir,ids):
    """Copy the staged files into the vault. Returns {id: wiki link}. Identical content that is already there is reused."""
    folder=attachment_dir(root,note_dir); folder.mkdir(parents=True,exist_ok=True)
    if not folder.resolve().is_relative_to(root): raise ValueError('附件文件夹超出了所选库')
    links={}; created=[]
    try:
        for attachment_id in ids:
            staged=base/'staging'/attachment_id
            try: meta=json.loads((staged/'meta.json').read_text(encoding='utf8')); data=staged/meta['file']; size=meta['size']; sha=meta['sha256']; name=meta['name']
            except (OSError,ValueError,KeyError): raise ValueError('附件已失效，请移除后重新添加')
            if not data.is_file() or data.stat().st_size!=size: raise ValueError(name+' 已失效，请移除后重新添加')
            stem,ext=Path(name).stem,Path(name).suffix
            candidates=[name,f'{stem}-{sha[:8]}{ext}']+[f'{stem}-{sha[:8]}-{i}{ext}' for i in range(2,50)]
            for candidate in candidates:
                path=folder/candidate
                if os.path.lexists(path):
                    if path.is_file() and not path.is_symlink() and path.stat().st_size==size and file_sha(path)==sha: break
                    continue
                if publish_file(data,path): created.append(path); break
            else: raise ValueError('无法为 '+name+' 找到可用的附件文件名')
            links[attachment_id]=link_text(path.relative_to(root).as_posix(),path.name)
    except BaseException:
        for path in created:
            try: os.unlink(path)
            except OSError: pass
        raise
    return links

# Entries carry no marker comments. Whether a capture was written is decided from the receipt journal instead:
# the receipt stores the diary's hash and length from before the write, so a retry can tell "untouched" (write it)
# from "original part unchanged and the entry follows it" (already written) without leaving anything in the note.
def sha(text):
    return hashlib.sha256(text.encode('utf8')).hexdigest()

def save_learning(message, root, base):
    capture_id=message.get('captureId','')
    if not isinstance(capture_id,str) or not re.fullmatch(r'[a-zA-Z0-9-]{8,80}',capture_id): return {'status':'failed','error':'学习记录标识无效'}
    content=message.get('content')
    if not isinstance(content,str) or not content.strip() or len(content.encode('utf8'))>MAX_BYTES: return {'status':'failed','error':'学习记录为空或超过 4 MB'}
    vault=message.get('vault') or ''
    if vault and vault not in {root.name,str(root)}: return {'status':'failed','error':'所选库与本地助手配置不一致'}
    ids=message.get('attachments') or []
    if not isinstance(ids,list) or len(ids)>MAX_ATTACHMENTS or len(set(ids))!=len(ids) or any(not isinstance(x,str) or not re.fullmatch(r'[0-9a-f]{32}',x) or marker(x) not in content for x in ids): return {'status':'failed','error':'附件列表无效'}
    digest=hashlib.sha256(content.encode('utf8')).hexdigest()
    def render(links):
        text=content
        for attachment_id,link in links.items(): text=text.replace(marker(attachment_id),link)
        return '\n\n'+text.rstrip()+'\n'
    links=None; piece=''
    receipt_file=base/'learning-receipts.json'
    base.mkdir(parents=True,exist_ok=True)
    with (base/'save.lock').open('a',encoding='utf8') as lock:
        lock_exclusive(lock)
        receipts=json.loads(receipt_file.read_text(encoding='utf8')) if receipt_file.exists() else {}
        if capture_id in receipts:
            previous=receipts[capture_id]
            if previous['digest']!=digest or previous['vault']!=str(root): return {'status':'unconfirmed','error':'此学习记录标识可能已写入其他内容，请先核对，再新建记录'}
            links=previous.get('links',{})
            if set(links)!=set(ids): return {'status':'unconfirmed','error':'此学习记录的附件与先前不一致，请先核对，再新建记录'}
            piece=render(links)
            path=Path(previous['path'])
            if not path.resolve().is_relative_to(root) or path.is_symlink() or (not path.is_file() and (previous.get('state')!='pending' or previous.get('originalExists'))): return {'status':'unconfirmed','error':'先前记录目标已移除或更改，请在 Obsidian 核对'}
            current=path.read_text(encoding='utf8') if path.exists() else ''
            pending=previous.get('state')=='pending'
            # Pending: the part that existed before our write must be intact, and our entry must follow it.
            # Saved: the entry must still be in the note. Anything else is for the user to check.
            if pending:
                size=previous.get('originalLength')
                if not isinstance(size,int) or sha(current[:size])!=previous.get('originalHash'):
                    return {'status':'unconfirmed','error':'先前目标已被外部修改，请在 Obsidian 核对，未重复追加'}
                found=piece in current[size:]
            else: found=piece in current
            if found:
                previous['state']='saved'
                try: atomic_json(receipt_file,receipts)
                except OSError: return {'status':'unconfirmed','error':'记录已找到但回执未完成，请同记录重试'}
                discard_staging(base,ids)
                return {**previous['result'],'duplicate':True}
            # Not found: only write again if the diary is exactly as it was before the interrupted attempt.
            if not pending or sha(current)!=previous.get('originalHash'): return {'status':'unconfirmed','error':'先前目标已被外部修改，请在 Obsidian 核对，未重复追加'}
        target_info=learning_daily_target(root,vault)
        if target_info['status']!='ready': return {'status':'failed','error':target_info.get('error','日记位置未知'),'target':target_info}
        if message.get('expectedTargetToken')!=target_info['targetToken']: return {'status':'target-changed','error':'今日日期或日记配置已变化，请核对目标后再保存','target':target_info}
        target=destination(root,'',target_info['relativePath'])
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.is_symlink() or not target.parent.resolve().is_relative_to(root): return {'status':'failed','error':'日记目标路径无效'}
        if links is None:
            # Attachments first: if any copy fails nothing has been written to the diary.
            try: links=commit_attachments(root,base,target.parent,ids)
            except (ValueError,OSError) as error: return {'status':'failed','error':str(error)}
            piece=render(links)
        result={'status':'saved','captureId':capture_id,'vault':root.name,'date':target_info['date'],'relativePath':target_info['relativePath']}
        original=target.read_text(encoding='utf8') if target.exists() else ''
        receipts[capture_id]={'digest':digest,'vault':str(root),'path':str(target),'result':result,'state':'pending','originalHash':sha(original),'originalLength':len(original),'originalExists':target.exists(),'links':links}
        # Persist the target BEFORE writing, so recovery after midnight still checks the original diary.
        atomic_json(receipt_file,receipts)
        # One O_APPEND write preserves existing/frontmatter and concurrent external appends.
        # Never replace an existing diary; detect external atomic file replacement as unconfirmed.
        flags=os.O_WRONLY|os.O_CREAT|os.O_APPEND|getattr(os,'O_NOFOLLOW',0)
        fd=os.open(target,flags,0o600)
        try:
            before=os.fstat(fd)
            live=target.stat()
            if (before.st_dev,before.st_ino)!=(live.st_dev,live.st_ino): return {'status':'unconfirmed','error':'日记被外部修改，请核对后重试'}
            data=piece.encode('utf8')
            count=os.write(fd,data)
            os.fsync(fd)
            live=target.stat()
            if count!=len(data) or (before.st_dev,before.st_ino)!=(live.st_dev,live.st_ino): return {'status':'unconfirmed','error':'写入期间日记发生变化，请在 Obsidian 核对'}
        finally: os.close(fd)
        if piece not in target.read_text(encoding='utf8'): return {'status':'unconfirmed','error':'无法确认记录仍在日记中，请核对后重试'}
        receipts[capture_id]={'digest':digest,'vault':str(root),'path':str(target),'result':result,'state':'saved','links':links}
        try: atomic_json(receipt_file,receipts)
        except OSError: return {'status':'unconfirmed','error':'记录可能已写入但回执未完成，请用同一记录重试'}
        discard_staging(base,ids)
        return result

def handle(message, config, base):
    if message.get('action')=='chooseVault':
        value=choose_vault(config.get('vault'))
        if value is None: return {'ok':False,'cancelled':True}
        selected=vault_directory(value)
        return {'ok':True,'vault':selected.name,'vaultPath':str(selected)}
    if message.get('action')=='configure':
        selected=vault_directory(message.get('vaultPath'))
        updated={**config,'vault':str(selected)}
        atomic_json(base/'config.json',updated)
        config.update(updated)
        return {'ok':True,'vault':selected.name,'vaultPath':str(selected)}
    if message.get('action') in {'attachPick','attachLocal','attachBytes','attachDiscard'}: return attach(message,base)
    root=Path(config['vault']).resolve()
    if not root.is_dir() or not (root/'.obsidian').is_dir(): raise ValueError('配置的 Obsidian 笔记库不存在')
    if message.get('action')=='status': return {'ok':True,'vault':root.name,'vaultPath':str(root)}
    if message.get('action')=='learningDailyTarget': return learning_daily_target(root,message.get('vault') or '')
    if message.get('action')=='saveLearning': return save_learning(message,root,base)
    if message.get('action')=='chooseNoteFolder':
        vault=message.get('vault') or ''
        if vault and vault not in {root.name,str(root)}: raise ValueError(f'请先在常规设置将静默保存的笔记库切换到 {vault}')
        initial=root
        try:
            candidate=root/relative_path(message.get('folder') or '')
            if candidate.is_dir() and candidate.resolve().is_relative_to(root): initial=candidate
        except ValueError: pass
        value=choose_vault(str(initial),f'请选择 {root.name} 库内的笔记文件夹')
        if value is None: return {'ok':False,'cancelled':True}
        selected=Path(value).resolve()
        if not selected.is_dir() or not selected.is_relative_to(root): raise ValueError(f'请选择 {root.name} 笔记库内的文件夹')
        folder=selected.relative_to(root).as_posix() if selected!=root else ''
        relative_path(folder)
        return {'ok':True,'vault':root.name,'folder':folder}
    if message.get('action')!='save': raise ValueError('不支持的本地操作')
    vault=message.get('vault') or ''
    if vault and vault not in {root.name,str(root)}: raise ValueError(f'静默保存已配置到 {root.name}，与所选库不一致')
    content=message.get('content')
    if not isinstance(content,str) or not content.strip() or len(content.encode())>MAX_BYTES: raise ValueError('笔记正文为空或超过 4 MB')
    behavior=message.get('behavior')
    if behavior not in BEHAVIORS: raise ValueError('笔记保存方式无效')
    request_id=message.get('requestId') or ''
    if not re.fullmatch(r'[a-zA-Z0-9-]{8,80}',request_id): raise ValueError('保存请求标识无效')
    target=daily_target(root) if behavior.endswith('-daily') else destination(root,message.get('folder') or '',message.get('name') or '')
    fingerprint=hashlib.sha256((str(root)+json.dumps(message,sort_keys=True,ensure_ascii=False)).encode()).hexdigest()
    base.mkdir(parents=True,exist_ok=True)
    with (base/'save.lock').open('a',encoding='utf8') as lock:
        lock_exclusive(lock)
        receipt_file=base/'receipts.json'
        receipts=json.loads(receipt_file.read_text(encoding='utf8')) if receipt_file.exists() else {}
        if request_id in receipts:
            prior=receipts[request_id]
            if prior['fingerprint']!=fingerprint: raise ValueError('保存请求标识已被用于其他内容')
            if not Path(prior['result']['path']).is_file(): raise ValueError('之前保存的笔记已移除，请重新剪藏')
            return {**prior['result'],'duplicate':True}
        target.parent.mkdir(parents=True,exist_ok=True)
        if not target.parent.resolve().is_relative_to(root) or target.is_symlink(): raise ValueError('不支持通过符号链接写入笔记')
        if behavior=='create':
            original=target; i=1
            while target.exists(): target=original.with_name(f'{original.stem} {i}.md'); i+=1
            # Exclusive creation protects existing notes, including concurrent external writers.
            with target.open('x',encoding='utf8') as f: f.write(content); f.flush(); os.fsync(f.fileno())
        else:
            previous=target.read_text(encoding='utf8') if target.exists() else ''
            if behavior.startswith('append') and previous: content=previous.rstrip()+'\n\n'+content.lstrip()
            if behavior.startswith('prepend') and previous: content=content.rstrip()+'\n\n'+previous.lstrip()
            fd,name=tempfile.mkstemp(dir=target.parent,suffix='.md')
            try:
                with os.fdopen(fd,'w',encoding='utf8') as f: f.write(content); f.flush(); os.fsync(f.fileno())
                os.replace(name,target)
            finally:
                if os.path.exists(name): os.unlink(name)
        result={'ok':True,'vault':root.name,'path':str(target),'relativePath':str(target.relative_to(root))}
        receipts[request_id]={'fingerprint':fingerprint,'result':result}
        atomic_json(receipt_file,dict(list(receipts.items())[-500:]))
        return result
def main():
    base=Path(__file__).resolve().parent
    if sys.platform=='win32':
        # Native messaging is binary framing; Windows stdio defaults to text mode and would mangle bytes.
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    try:
        config=json.loads((base/'config.json').read_text(encoding='utf8'))
        if len(sys.argv)<2 or sys.argv[1] not in ([config['origin']] if 'origin' in config else [])+list(config.get('origins',[])): raise ValueError('本地保存请求来源无效')
        header=sys.stdin.buffer.read(4)
        if len(header)!=4: raise ValueError('本地保存请求不完整')
        length=struct.unpack('=I',header)[0]
        if length>MAX_REQUEST: raise ValueError('本地保存请求过大')
        body=sys.stdin.buffer.read(length)
        if len(body)!=length: raise ValueError('本地保存请求不完整')
        result=handle(json.loads(body),config,base)
    except Exception as e: result={'ok':False,'error':str(e)}
    data=json.dumps(result,ensure_ascii=False).encode()
    sys.stdout.buffer.write(struct.pack('=I',len(data))+data);sys.stdout.buffer.flush()
if __name__=='__main__': main()
