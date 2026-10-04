#!/usr/bin/env python3
"""Chrome native host: write Markdown only inside the explicitly configured vault."""
import datetime, fcntl, hashlib, json, os, re, struct, subprocess, sys, tempfile
from pathlib import Path
MAX_BYTES = 4 * 1024 * 1024
BEHAVIORS = {'create','append-specific','prepend-specific','append-daily','prepend-daily','overwrite'}
def atomic_json(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f: json.dump(data,f,ensure_ascii=False); f.flush(); os.fsync(f.fileno())
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
    data=json.loads(config.read_text()) if config.exists() else {}
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
    digest=hashlib.sha256(content.encode('utf8')).hexdigest()
    piece='\n\n'+content.rstrip()+'\n'
    receipt_file=base/'learning-receipts.json'
    base.mkdir(parents=True,exist_ok=True)
    with (base/'save.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        receipts=json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
        if capture_id in receipts:
            previous=receipts[capture_id]
            if previous['digest']!=digest or previous['vault']!=str(root): return {'status':'unconfirmed','error':'此学习记录标识可能已写入其他内容，请先核对，再新建记录'}
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
                return {**previous['result'],'duplicate':True}
            # Not found: only write again if the diary is exactly as it was before the interrupted attempt.
            if not pending or sha(current)!=previous.get('originalHash'): return {'status':'unconfirmed','error':'先前目标已被外部修改，请在 Obsidian 核对，未重复追加'}
        target_info=learning_daily_target(root,vault)
        if target_info['status']!='ready': return {'status':'failed','error':target_info.get('error','日记位置未知'),'target':target_info}
        if message.get('expectedTargetToken')!=target_info['targetToken']: return {'status':'target-changed','error':'今日日期或日记配置已变化，请核对目标后再保存','target':target_info}
        target=destination(root,'',target_info['relativePath'])
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.is_symlink() or not target.parent.resolve().is_relative_to(root): return {'status':'failed','error':'日记目标路径无效'}
        result={'status':'saved','captureId':capture_id,'vault':root.name,'date':target_info['date'],'relativePath':target_info['relativePath']}
        original=target.read_text(encoding='utf8') if target.exists() else ''
        receipts[capture_id]={'digest':digest,'vault':str(root),'path':str(target),'result':result,'state':'pending','originalHash':sha(original),'originalLength':len(original),'originalExists':target.exists()}
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
        receipts[capture_id]={'digest':digest,'vault':str(root),'path':str(target),'result':result,'state':'saved'}
        try: atomic_json(receipt_file,receipts)
        except OSError: return {'status':'unconfirmed','error':'记录可能已写入但回执未完成，请用同一记录重试'}
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
    with (base/'save.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        receipt_file=base/'receipts.json'
        receipts=json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
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
            previous=target.read_text() if target.exists() else ''
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
    try:
        config=json.loads((base/'config.json').read_text())
        if len(sys.argv)<2 or sys.argv[1] != config['origin']: raise ValueError('本地保存请求来源无效')
        header=sys.stdin.buffer.read(4)
        if len(header)!=4: raise ValueError('本地保存请求不完整')
        length=struct.unpack('=I',header)[0]
        if length>MAX_BYTES+65536: raise ValueError('本地保存请求过大')
        body=sys.stdin.buffer.read(length)
        if len(body)!=length: raise ValueError('本地保存请求不完整')
        result=handle(json.loads(body),config,base)
    except Exception as e: result={'ok':False,'error':str(e)}
    data=json.dumps(result,ensure_ascii=False).encode()
    sys.stdout.buffer.write(struct.pack('=I',len(data))+data);sys.stdout.buffer.flush()
if __name__=='__main__': main()
